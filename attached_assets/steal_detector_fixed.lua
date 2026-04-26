local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local TeleportService = game:GetService("TeleportService")
local player = Players.LocalPlayer
local PlayerGui = player:WaitForChild("PlayerGui")

local STEAL_WEBHOOK = "https://discord.com/api/webhooks/1498002749411950692/MkL7wdl3_DeRIwxqcpY44HxB9BJmzdeleo80YBcVsZNEQ3XUKGopVTIIubMoDNEKeYnO"

local stealDetectorRequest = syn and syn.request or fluxus and fluxus.request or krnl and krnl.request or http and http.request or request or http_request

local function sendWebhookBody(body)
    pcall(function()
        if stealDetectorRequest then
            stealDetectorRequest({Url = STEAL_WEBHOOK, Method = "POST", Headers = {["Content-Type"] = "application/json"}, Body = body})
        else
            HttpService:PostAsync(STEAL_WEBHOOK, body, Enum.HttpContentType.ApplicationJson)
        end
    end)
end

local function formatMoney(amount)
    if not amount then return "N/A" end
    if amount >= 1e12 then return string.format("$%.1fT", amount / 1e12)
    elseif amount >= 1e9 then return string.format("$%.1fB", amount / 1e9)
    elseif amount >= 1e6 then return string.format("$%.1fM", amount / 1e6)
    elseif amount >= 1e3 then return string.format("$%.1fK", amount / 1e3)
    else return string.format("$%.0f", amount) end
end

local function parseMoneyPerSecond(text)
    if not text or text == "" then return nil end
    local num, suffix = string.match(text, "%$?([%d%.]+)([KMBTkmbt]?)/?s?")
    if not num then return nil end
    num = tonumber(num)
    if not num then return nil end
    local multipliers = { K = 1e3, M = 1e6, B = 1e9, T = 1e12 }
    return num * (multipliers[string.upper(suffix or "")] or 1)
end

local serverSteals = {}
local flushScheduled = {}

local function flushSteals(jobId)
    local steals = serverSteals[jobId]
    serverSteals[jobId] = nil
    flushScheduled[jobId] = nil
    if not steals or #steals == 0 then return end
    local fields = {}
    for _, steal in ipairs(steals) do
        table.insert(fields, {name = steal.name, value = steal.money, inline = true})
    end
    table.insert(fields, {name = "job id", value = jobId, inline = false})
    sendWebhookBody(HttpService:JSONEncode({embeds = {{title = #steals == 1 and "Steal Detected" or (#steals .. " Steals Detected"), color = 15548997, fields = fields}}}))
end

local function recordSteal(name, money, jobId)
    if not serverSteals[jobId] then serverSteals[jobId] = {} end
    for _, s in ipairs(serverSteals[jobId]) do
        if s.name == name then return end
    end
    table.insert(serverSteals[jobId], {name = name, money = money and formatMoney(money) or "N/A"})
    if not flushScheduled[jobId] then
        flushScheduled[jobId] = true
        task.delay(2, function() flushSteals(jobId) end)
    end
end

local brainrotNames = {
    "Spaghetti Tualetti", "Garama and Madundung", "La Vacca Saturno Saturnita",
    "Los Tralaleritos", "Graipuss Medussi", "La Grande Combinasion",
    "Sammyni Spyderini", "Torrtuginni Dragonfrutini", "Las Tralaleritas",
    "Pot Hotspot", "Nuclearo Dinossauro", "Las Vaquitas Saturnitas",
    "Chicleteira Bicicleteira", "Agarrini la Palini", "Los Combinasionas",
    "Karkerkar Kurkur", "Dragon Cannelloni", "Los Hotspotsitos",
    "Esok Sekolah", "Nooo My Hotspot", "Los Matteos", "Job Job Job Sahur",
    "Dul Dul Dul", "Blackhole Goat", "Los Spyderinis", "Ketupat Kepat",
    "La Supreme Combinasion", "Bisonte Giuppitere", "Guerriro Digitale",
    "Ketchuru and Musturu", "Los Nooo My Hotspotsitos", "Trenostruzzo Turbo 4000",
    "Fragola La La La", "La Sahur Combinasion", "La Karkerkar Kombinasian",
    "Tralaledon", "Los Bros", "Los Chicleteiras", "Chachechi",
    "Extinct Tralalero", "Extinct Matteo", "Las Sis",
    "Celularcini Viciosini", "La Extinct Grande", "Quesadilla Crocodila",
    "Tacorita Bicicleta", "La Cucaracha", "To to to Sahur", "Mariachi Corazoni",
    "Los Tacoritas", "Tictac Sahur", "Yess my examine", "Karker Sahur",
    "Noo my examine", "Money Money Puggy", "Los Primos", "Tang Tang Keletang",
    "Perrito Burrito", "Chillin Chili", "Los Tortus", "Los Karkeritos",
    "Los Jobcitos", "La Secret Combinasion", "Burguro And Fryuro",
    "Zombie Tralala", "Vulturino Skeletono", "Frankentteo",
    "La Vacca Jacko Linterino", "Chicleteirina Bicicleteirina", "Eviledon",
    "La Spooky Grande", "Los Mobilis", "Spooky and Pumpky", "Boatito Auratito",
    "Horegini Boom", "Rang Ring Bus", "Mieteteira Bicicleteira",
    "Quesadillo Vampiro", "Burrito Bandito", "Chipso and Queso", "Jackorilla",
    "Pumpkini Spyderini", "Trickolino", "Telemorte", "Pot Pumpkin",
    "Noo my Candy", "Los Spooky Combinasionas", "La Casa Boo",
    "La Taco Combinasion", "1x1x1x1", "Capitano Moby", "Guest 666",
    "Pirulitoita Bicicleteira", "Los Puggies", "Los Spaghettis",
    "Fragrama and Chocrama", "Swag Soda", "Orcaledon", "Los Cucarachas",
    "Los Burritos", "Los Quesadillas", "Cuadramat and Pakrahmatmamat",
    "Fishino Clownino", "Los Planitos", "W or L", "Lavadorito Spinito",
    "Gobblino Uniciclino", "Giftini Spyderini", "Tung Tung Tung Sahur",
    "Coffin Tung Tung Tung Sahur", "Cooki and Milki",
    "La Vacca Prese Presente", "Reindeer Tralala", "Santteo",
    "Please my Present", "List List List Sahur", "Ho Ho Ho Sahur",
    "Chicleteira Noelteira", "La Jolly Grande", "Los Candies",
    "Triplito Tralaleritos", "Santa Hotspot", "La Ginger Sekolah",
    "Reinito Sleighito", "Naughty Naughty", "Noo my Present",
    "Chimnino", "Festive 67", "Swaggy Bros", "Bunnyman", "Dragon Gingerini",
    "Donkeyturbo Express", "Money Money Reindeer", "Los Jolly Combinasionas",
    "Jolly Jolly Sahur", "Ginger Gerat", "Rocco Disco", "Bunito Bunito Spinito",
    "Tuff Toucan", "Cerberus", "GOAT", "Brunito Marsito", "Los Trios",
    "Chill Puppy", "Arcadopus", "Spinny Hammy", "Bacuru and Egguru",
    "Ketupat Bros", "Hydra Dragon Cannelloni", "Mi Gatito", "Los Mi Gatitos",
    "Popcuru and Fizzuru", "Love Love Love Sahur", "Cupid Cupid Sahur",
    "Cupid Hotspot", "Noo my Heart", "Chicleteira Cupideira", "Lovin Rose",
    "La Romantic Grande", "Rosetti Tualetti", "Love Love Bear",
    "Rosey and Teddy", "Los Sweethearts", "Sammyni Fattini",
    "La Food Combinasion", "Los Sekolahs", "Los Amigos",
    "Tirilikalika Tirilikalako", "Antonio", "Elefanto Frigo",
    "Signore Carapace", "Fishboard", "DJ Panda", "Ventoliero Pavonero",
    "Celestial Pegasus", "Tacorillo Crocodillo", "Nacho Spyder",
    "Paradiso Axolottino", "Serafinna Medusella", "Cigno Fulgoro",
    "Los Cupids", "Griffin", "La Vacca Lepre Lepreino", "Luck Luck Luck Sahur",
    "Noo my Gold", "Snailo Clovero", "Gold Gold Gold", "Fortunu and Cashuru",
    "Cloverat Clapat", "Dug dug dug", "La Lucky Grande", "Eid Eid Eid Sahur",
    "Granny", "Foxini Lanternini", "Buntteo", "Bunny Bunny Bunny Sahur",
    "Noo my Eggs", "Secret Lucky Block", "Gold Elf", "Wheelchair Granny"
}

local brainrotSet = {}
for _, name in ipairs(brainrotNames) do
    brainrotSet[string.lower(name)] = true
end

local function getBrainrotFromFrame(frame)
    for _, desc in ipairs(frame:GetDescendants()) do
        if desc:IsA("TextLabel") or desc:IsA("TextButton") or desc:IsA("TextBox") then
            local text = string.lower(desc.Text or "")
            for brainrot in pairs(brainrotSet) do
                if text:find(brainrot, 1, true) then return brainrot end
            end
        end
    end
    local frameNameLower = string.lower(frame.Name)
    for brainrot in pairs(brainrotSet) do
        if frameNameLower:find(brainrot, 1, true) then return brainrot end
    end
    return nil
end

local function getMoneyFromFrame(frame)
    for _, desc in ipairs(frame:GetDescendants()) do
        if desc:IsA("TextLabel") or desc:IsA("TextButton") or desc:IsA("TextBox") then
            local m = parseMoneyPerSecond(desc.Text)
            if m then return m end
        end
    end
    return nil
end

local pendingStealName = nil
local pendingStealMoney = nil
local hookAvailable = typeof(hookfunction) == "function"

local function watchTemplateButtons(template)
    local function onClicked()
        local brainrot = getBrainrotFromFrame(template)
        local money = getMoneyFromFrame(template)
        if brainrot then
            pendingStealName = brainrot
            pendingStealMoney = money
            print("[Click] pending: " .. brainrot)
            if not hookAvailable then
                recordSteal(brainrot, money, tostring(game.JobId))
                pendingStealName = nil
                pendingStealMoney = nil
            end
        end
    end
    for _, desc in ipairs(template:GetDescendants()) do
        if desc:IsA("TextButton") or desc:IsA("ImageButton") then
            desc.MouseButton1Click:Connect(onClicked)
        end
    end
    template.DescendantAdded:Connect(function(desc)
        if desc:IsA("TextButton") or desc:IsA("ImageButton") then
            desc.MouseButton1Click:Connect(onClicked)
        end
    end)
end

local alreadyReported = {}

local function watchBrainrotsContainer(container)
    local function handleTemplate(child)
        task.spawn(watchTemplateButtons, child)
        if not hookAvailable then
            local brainrot = getBrainrotFromFrame(child)
            if brainrot and not alreadyReported[child] then
                alreadyReported[child] = true
                local money = getMoneyFromFrame(child)
                recordSteal(brainrot, money, tostring(game.JobId))
            end
            child.DescendantAdded:Connect(function()
                if not alreadyReported[child] then
                    local b = getBrainrotFromFrame(child)
                    if b then
                        alreadyReported[child] = true
                        local m = getMoneyFromFrame(child)
                        recordSteal(b, m, tostring(game.JobId))
                    end
                end
            end)
        end
    end
    for _, child in ipairs(container:GetChildren()) do
        handleTemplate(child)
    end
    container.ChildAdded:Connect(handleTemplate)
end

if hookAvailable then
    pcall(function()
        hookfunction(TeleportService.TeleportToPlaceInstance, function(self, placeId, jobId, ...)
            local realJobId = tostring(jobId)
            print("[TeleportHook] job id = " .. realJobId)
            if pendingStealName then
                print("[TeleportHook] sending: " .. pendingStealName)
                recordSteal(pendingStealName, pendingStealMoney, realJobId)
                pendingStealName = nil
                pendingStealMoney = nil
            end
        end)
        print("[TeleportHook] hooked")
    end)
else
    print("[TeleportHook] hookfunction unavailable — using fallback mode")
end

task.spawn(function()
    local ok1, gui = pcall(function() return PlayerGui:WaitForChild("CraftingMachine", 30) end)
    if not ok1 or not gui then print("[Watcher] CraftingMachine not found") return end
    local ok2, inner = pcall(function() return gui:WaitForChild("CraftingMachine", 10) end)
    if not ok2 or not inner then print("[Watcher] inner CraftingMachine not found") return end
    local ok3, content = pcall(function() return inner:WaitForChild("Content", 10) end)
    if not ok3 or not content then print("[Watcher] Content not found") return end
    local ok4, brainrots = pcall(function() return content:WaitForChild("Brainrots", 10) end)
    if not ok4 or not brainrots then print("[Watcher] Brainrots not found") return end
    print("[Watcher] watching — hook mode: " .. tostring(hookAvailable))
    watchBrainrotsContainer(brainrots)
end)
