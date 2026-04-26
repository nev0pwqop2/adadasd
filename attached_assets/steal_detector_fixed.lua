local Players = game:GetService("Players")
local TeleportService = game:GetService("TeleportService")
local HttpService = game:GetService("HttpService")
local player = Players.LocalPlayer
local PlayerGui = player:WaitForChild("PlayerGui")

local STEAL_WEBHOOK = "https://discord.com/api/webhooks/1490759560426946590/p9sRlWhB9ZPJZOb3dIuLtG0k5M8gNLbp2MPMgjPyRv-53VrOfI4vpXLqvOCl7DVZU-vP"

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
    brainrotSet[string.lower(name)] = name
end

local capturingFor = nil
local capturing = false

hookfunction(TeleportService.TeleportToPlaceInstance, function(self, placeId, instanceId, ...)
    local jobId = tostring(instanceId)
    if capturing and capturingFor then
        print("[StealDetector] AUTO | brainrot=" .. capturingFor.name .. " | jobId=" .. jobId)
        local fields = {
            {name = "brainrot", value = capturingFor.name, inline = true},
            {name = "generation", value = capturingFor.money and formatMoney(capturingFor.money) or "N/A", inline = true},
            {name = "job id", value = jobId, inline = false}
        }
        sendWebhookBody(HttpService:JSONEncode({embeds = {{
            title = "Steal Detected",
            color = 15548997,
            fields = fields
        }}}))
    else
        print("[StealDetector] MANUAL CLICK BLOCKED | jobId=" .. jobId .. " | placeId=" .. tostring(placeId))
    end
end)

local function getBrainrotFromFrame(frame)
    for _, desc in ipairs(frame:GetDescendants()) do
        if desc:IsA("TextLabel") or desc:IsA("TextButton") or desc:IsA("TextBox") then
            local t = string.lower(desc.Text or "")
            for bl, bo in pairs(brainrotSet) do
                if t:find(bl, 1, true) then return bo end
            end
        end
    end
    local nl = string.lower(frame.Name)
    for bl, bo in pairs(brainrotSet) do
        if nl:find(bl, 1, true) then return bo end
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

local function getJoinButtonFromFrame(frame)
    local joinKeywords = {"join", "steal", "teleport"}
    for _, desc in ipairs(frame:GetDescendants()) do
        if desc:IsA("TextButton") or desc:IsA("ImageButton") then
            local nl = string.lower(desc.Name)
            local tl = desc:IsA("TextButton") and string.lower(desc.Text or "") or ""
            for _, kw in ipairs(joinKeywords) do
                if nl:find(kw) or tl:find(kw) then return desc end
            end
        end
    end
    for _, desc in ipairs(frame:GetDescendants()) do
        if desc:IsA("TextButton") or desc:IsA("ImageButton") then
            return desc
        end
    end
    return nil
end

local processed = {}

local function processFrame(frame)
    if processed[frame] then return end
    local brainrot = getBrainrotFromFrame(frame)
    if not brainrot then return end
    local btn = getJoinButtonFromFrame(frame)
    if not btn then return end
    processed[frame] = true

    local money = getMoneyFromFrame(frame)
    print("[StealDetector] found: " .. brainrot .. " | simulating click...")

    capturingFor = {name = brainrot, money = money}
    capturing = true
    task.spawn(function()
        firesignal(btn.MouseButton1Click)
        task.wait(0.5)
        capturing = false
        capturingFor = nil
    end)
end

local function scanAll()
    for _, desc in ipairs(PlayerGui:GetDescendants()) do
        if desc:IsA("Frame") or desc:IsA("ScrollingFrame") or desc:IsA("CanvasGroup") then
            task.spawn(processFrame, desc)
            task.wait(0.2)
        end
    end
end

PlayerGui.DescendantAdded:Connect(function(desc)
    if desc:IsA("Frame") or desc:IsA("ScrollingFrame") or desc:IsA("CanvasGroup") then
        task.wait(0.1)
        task.spawn(processFrame, desc)
    end
end)

task.spawn(function()
    task.wait(2)
    print("[StealDetector] scanning GUI...")
    scanAll()
    print("[StealDetector] done scanning, watching for new frames")
end)
