local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local WEBHOOK_CONFIG = {
    webhookUrl = "https://discord.com/api/webhooks/1496254455233122425/YSEswlUC5G5OSY4TdHTaFq8UsrFjgQX-xpKeVE6yP5N03AjfY7VNYBOyOTiPCK4R1SVP",
    embedColor = 0xFFFF00,
    timeout = 10,
}

local WS_RELAY_URL = "wss://gigue.onrender.com/ws/steal"

local LocalPlayer = Players.LocalPlayer
local sentBrainrots = {}

-- ─── WS relay ────────────────────────────────────────────────────────────────
local wsConn = nil
local wsReady = false
local relayQueue = {}

local function drainRelayQueue()
    if #relayQueue == 0 then return end
    print("[DEBUG] Draining relay queue — " .. #relayQueue .. " item(s)")
    local queue = relayQueue
    relayQueue = {}
    for _, payload in ipairs(queue) do
        local ok, err = pcall(function() wsConn:Send(payload) end)
        if ok then
            print("[DEBUG] Queue drain send OK")
        else
            print("[DEBUG] Queue drain send FAILED: " .. tostring(err))
            table.insert(relayQueue, payload)
        end
    end
end

local function connectRelay()
    print("[DEBUG] Attempting WS connect to " .. WS_RELAY_URL)
    local ok, err = pcall(function()
        wsConn = WebSocket.connect(WS_RELAY_URL)
        wsReady = true
        print("[DEBUG] WS relay CONNECTED OK")
        task.spawn(drainRelayQueue)
        wsConn.OnClose:Connect(function()
            wsReady = false
            wsConn = nil
            print("[DEBUG] WS relay CLOSED — retrying in 5s")
            task.delay(5, connectRelay)
        end)
        wsConn.OnMessage:Connect(function(msg)
            print("[DEBUG] WS relay msg received: " .. tostring(msg))
        end)
    end)
    if not ok then
        print("[DEBUG] WS connect ERROR: " .. tostring(err))
    end
    if not wsReady then
        print("[DEBUG] WS not ready after connect attempt — retrying in 5s")
        task.delay(5, connectRelay)
    end
end

task.spawn(connectRelay)
-- ─────────────────────────────────────────────────────────────────────────────

local function getDiscordId()
    -- LRM sets LRM_LinkedDiscordID as a global — direct access is safe in Lua (undefined globals = nil)
    if LRM_LinkedDiscordID and tostring(LRM_LinkedDiscordID) ~= "" then
        print("[DEBUG] Discord ID from direct global: " .. tostring(LRM_LinkedDiscordID))
        return tostring(LRM_LinkedDiscordID)
    end

    local ok, id = pcall(function()
        local g = getgenv and getgenv() or nil
        if g and g.LRM_LinkedDiscordID and tostring(g.LRM_LinkedDiscordID) ~= "" then
            return tostring(g.LRM_LinkedDiscordID)
        end
        if _G and _G.LRM_LinkedDiscordID and tostring(_G.LRM_LinkedDiscordID) ~= "" then
            return tostring(_G.LRM_LinkedDiscordID)
        end
        if shared and shared.LRM_LinkedDiscordID and tostring(shared.LRM_LinkedDiscordID) ~= "" then
            return tostring(shared.LRM_LinkedDiscordID)
        end
        return nil
    end)

    if ok and id then
        print("[DEBUG] Discord ID from env scope: " .. id)
        return id
    end

    print("[DEBUG] Discord ID NOT found in any scope")
    return nil
end

local function getBrainrotImage(brainrotName)
    local encoded = brainrotName:gsub(" ", "%%20")
    local url = ("https://stealabrainrot.fandom.com/api.php?action=query&prop=pageimages&format=json&piprop=thumbnail&pithumbsize=500&titles=%s"):format(encoded)
    print("[DEBUG] Fetching image for: " .. brainrotName)
    local ok, result = pcall(function()
        local response = http_request({ Url = url, Method = "GET" })
        if response and response.StatusCode == 200 then
            local data = HttpService:JSONDecode(response.Body)
            local pages = data and data.query and data.query.pages
            if pages then
                for _, page in pairs(pages) do
                    if page.thumbnail and page.thumbnail.source then
                        print("[DEBUG] Image found: " .. page.thumbnail.source)
                        return page.thumbnail.source
                    end
                end
            end
        else
            print("[DEBUG] Image fetch failed, status: " .. tostring(response and response.StatusCode))
        end
        return nil
    end)
    if not ok then
        print("[DEBUG] Image fetch error: " .. tostring(result))
    end
    return ok and result or nil
end

local function sendToRelay(brainrots, thumbnailUrl, discordId)
    print("[DEBUG] sendToRelay called — wsReady=" .. tostring(wsReady) .. " wsConn=" .. tostring(wsConn ~= nil))
    for _, brainrot in ipairs(brainrots) do
        local payload = HttpService:JSONEncode({
            brainrotName = brainrot.name,
            moneyPerSec  = brainrot.gen,
            imageUrl     = thumbnailUrl,
            discordId    = discordId or "unknown",
        })
        if not wsReady or not wsConn then
            print("[DEBUG] WS not ready — queuing " .. brainrot.name .. " for retry")
            table.insert(relayQueue, payload)
        else
            print("[DEBUG] Sending to relay: " .. payload)
            local ok, err = pcall(function()
                wsConn:Send(payload)
            end)
            if ok then
                print("[DEBUG] Relay send OK for " .. brainrot.name)
            else
                print("[DEBUG] Relay send FAILED — queuing: " .. tostring(err))
                table.insert(relayQueue, payload)
            end
        end
    end
end

local function sendBatchWebhook(brainrots)
    if #brainrots == 0 then return end
    print("[DEBUG] sendBatchWebhook called with " .. #brainrots .. " brainrot(s)")

    local discordId = getDiscordId() or "unknown"
    print("[DEBUG] Using discordId: " .. discordId)

    local timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ")
    table.sort(brainrots, function(a, b) return a.value > b.value end)

    -- Send to relay FIRST — before any HTTP that could hang
    sendToRelay(brainrots, nil, discordId)

    local highestBrainrot = brainrots[1]
    local thumbnailUrl = nil
    if highestBrainrot then
        print("[DEBUG] Getting thumbnail for: " .. highestBrainrot.name)
        thumbnailUrl = getBrainrotImage(highestBrainrot.name)
        print("[DEBUG] thumbnailUrl = " .. tostring(thumbnailUrl))
    end

    local brainrotList = ""
    for _, brainrot in ipairs(brainrots) do
        brainrotList = brainrotList .. brainrot.name .. " | " .. brainrot.gen .. "/sec\n"
    end

    local embed = {
        title = "Brainrot joined",
        color = 0xFFFF00,
        description = "Joined by <@" .. discordId .. ">",
        fields = {
            { name = "Brainrots", value = "```\n" .. brainrotList .. "```", inline = false },
        },
        footer = { text = "Successfully joined" },
        timestamp = timestamp,
    }
    if thumbnailUrl and thumbnailUrl ~= "" then
        embed.thumbnail = { url = thumbnailUrl }
    end

    local payload = { username = "Brainrot detector", embeds = { embed } }
    local body = HttpService:JSONEncode(payload)
    print("[DEBUG] Sending Discord webhook...")
    local ok, err = pcall(function()
        local res = http_request({
            Url = WEBHOOK_CONFIG.webhookUrl,
            Method = "POST",
            Headers = { ["Content-Type"] = "application/json" },
            Body = body
        })
        print("[DEBUG] Webhook response status: " .. tostring(res and res.StatusCode))
    end)
    if not ok then
        print("[DEBUG] Webhook send ERROR: " .. tostring(err))
    end
end

-- =========================
-- SCANNER MODULE
-- =========================

local sync = require(ReplicatedStorage:WaitForChild("Packages"):WaitForChild("Synchronizer"))
local adar = require(ReplicatedStorage:WaitForChild("Datas"):WaitForChild("Animals"))
local as = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Animals"))
local nu = require(ReplicatedStorage:WaitForChild("Utils"):WaitForChild("NumberUtils"))

print("[Brainrot Detector] Modules loaded")

local function shouldScan(value)
    return value >= 1e7
end

local loggedBrainrots = {}

local function isAlreadyLogged(name, gen)
    return loggedBrainrots[name .. ":" .. gen] == true
end

local function markAsLogged(name, gen)
    loggedBrainrots[name .. ":" .. gen] = true
end

local function scanCarpet()
    local results = {}
    for _, instance in ipairs(Workspace:GetChildren()) do
        if instance.ClassName ~= "Model" then continue end
        local name = instance:GetAttribute("Index")
        if not name then continue end
        if not adar[name] then continue end
        local mutation = instance:GetAttribute("Mutation")
        if type(mutation) ~= "string" or mutation == "" then mutation = nil end
        local traitsTable = nil
        local traitsRaw = instance:GetAttribute("Traits")
        if traitsRaw and type(traitsRaw) == "string" then
            local ok, decoded = pcall(HttpService.JSONDecode, HttpService, traitsRaw)
            if ok and type(decoded) == "table" then
                traitsTable = {}
                if #decoded > 0 then
                    for _, trait in ipairs(decoded) do
                        if type(trait) == "string" then table.insert(traitsTable, trait) end
                    end
                else
                    for traitName, enabled in pairs(decoded) do
                        if enabled then table.insert(traitsTable, traitName) end
                    end
                end
                if #traitsTable == 0 then traitsTable = nil end
            end
        end
        local ok3, genValue = pcall(function() return as:GetGeneration(name, mutation, traitsTable, nil) end)
        if not ok3 then continue end
        if not shouldScan(genValue) then continue end
        local genText = "$" .. nu:ToString(genValue) .. "/s"
        if isAlreadyLogged(name, genText) then continue end
        table.insert(results, { name = name, gen = genText, value = genValue })
    end
    return results
end

local function scanPlots()
    local results = {}
    local plots = Workspace:FindFirstChild("Plots")
    if not plots then return results end
    for _, plot in ipairs(plots:GetChildren()) do
        local ok, pot = pcall(function() return sync:Get(plot.Name) end)
        if not ok or not pot then continue end
        local ok2, list = pcall(function() return pot:Get("AnimalList") end)
        if not ok2 or type(list) ~= "table" then continue end
        for _, animalData in pairs(list) do
            if type(animalData) ~= "table" then continue end
            local name = animalData.Index
            if not adar[name] then continue end
            local data = animalData.Data or animalData
            local mutation = data.Mutation
            if type(mutation) ~= "string" or mutation == "" then mutation = nil end
            local traitsTable = nil
            if type(data.Traits) == "table" then
                traitsTable = {}
                if #data.Traits > 0 then
                    for _, trait in ipairs(data.Traits) do
                        if type(trait) == "string" then table.insert(traitsTable, trait) end
                    end
                else
                    for traitName, enabled in pairs(data.Traits) do
                        if enabled then table.insert(traitsTable, traitName) end
                    end
                end
                if #traitsTable == 0 then traitsTable = nil end
            end
            local ok3, genValue = pcall(function() return as:GetGeneration(name, mutation, traitsTable, nil) end)
            if not ok3 then continue end
            if not shouldScan(genValue) then continue end
            local genText = "$" .. nu:ToString(genValue) .. "/s"
            if isAlreadyLogged(name, genText) then continue end
            table.insert(results, { name = name, gen = genText, value = genValue })
        end
    end
    return results
end

local function scanAll()
    local results = {}
    for _, r in ipairs(scanPlots()) do table.insert(results, r) end
    for _, r in ipairs(scanCarpet()) do table.insert(results, r) end
    return results
end

local SCAN_INTERVAL = 0.5
local BATCH_DELAY = 1
local lastBatchTime = os.clock()
local pendingBrainrots = {}

print("[Brainrot Detector] Started — scanning every " .. SCAN_INTERVAL .. "s, batch every " .. BATCH_DELAY .. "s (10M+ only)")

while true do
    local results = scanAll()

    for _, brainrot in ipairs(results) do
        local key = brainrot.name .. brainrot.gen
        if not sentBrainrots[key] then
            sentBrainrots[key] = true
            markAsLogged(brainrot.name, brainrot.gen)
            table.insert(pendingBrainrots, brainrot)
            print("[Brainrot Detector] Found: " .. brainrot.name .. " | " .. brainrot.gen)
        end
    end

    local now = os.clock()
    if now - lastBatchTime >= BATCH_DELAY and #pendingBrainrots > 0 then
        print("[DEBUG] Batch firing with " .. #pendingBrainrots .. " brainrot(s)")
        local batch = pendingBrainrots
        pendingBrainrots = {}
        lastBatchTime = now
        task.spawn(function()
            sendBatchWebhook(batch)
        end)
    end

    task.wait(SCAN_INTERVAL)
end
