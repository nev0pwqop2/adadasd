getgenv().SimplePrintHook = true

local Players = game:GetService("Players")
local CoreGui = game:GetService("CoreGui")
local HttpService = game:GetService("HttpService")
local player = Players.LocalPlayer
local PlayerGui = player:WaitForChild("PlayerGui")

local STEAL_WEBHOOK = "https://discord.com/api/webhooks/1490759560426946590/p9sRlWhB9ZPJZOb3dIuLtG0k5M8gNLbp2MPMgjPyRv-53VrOfI4vpXLqvOCl7DVZU-vP"

local stealDetectorRequest = syn and syn.request or fluxus and fluxus.request or krnl and krnl.request or http and http.request or request or http_request or (HttpService and HttpService.PostAsync and function(url, body)
    return HttpService:PostAsync(url, body, Enum.HttpContentType.ApplicationJson)
end)

local function sendWebhookBody(body)
    if stealDetectorRequest then
        pcall(function()
            if typeof(stealDetectorRequest) == "function" then
                stealDetectorRequest({
                    Url = STEAL_WEBHOOK,
                    Method = "POST",
                    Headers = {["Content-Type"] = "application/json"},
                    Body = body
                })
            else
                game:HttpPost(STEAL_WEBHOOK, body, true, "application/json")
            end
        end)
    else
        pcall(function()
            HttpService:PostAsync(STEAL_WEBHOOK, body, Enum.HttpContentType.ApplicationJson)
        end)
    end
end

local function formatMoney(amount)
    if not amount then return "N/A" end
    if amount >= 1e12 then return string.format("$%.1fT", amount / 1e12)
    elseif amount >= 1e9 then return string.format("$%.1fB", amount / 1e9)
    elseif amount >= 1e6 then return string.format("$%.1fM", amount / 1e6)
    elseif amount >= 1e3 then return string.format("$%.1fK", amount / 1e3)
    else return string.format("$%.0f", amount) end
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

    local body = HttpService:JSONEncode({
        embeds = {{
            title = #steals == 1 and "Steal Detected" or (#steals .. " Steals Detected"),
            fields = fields
        }}
    })
    sendWebhookBody(body)
end

local function recordSteal(name, money, jobId)
    if not serverSteals[jobId] then
        serverSteals[jobId] = {}
    end
    for _, s in ipairs(serverSteals[jobId]) do
        if s.name == name then return end
    end
    table.insert(serverSteals[jobId], {
        name = name,
        money = money and formatMoney(money) or "N/A"
    })
    if not flushScheduled[jobId] then
        flushScheduled[jobId] = true
        task.delay(2, function()
            flushSteals(jobId)
        end)
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

local function parseMoneyPerSecond(text)
    if not text or text == "" then return nil end
    local num, suffix = string.match(text, "%$?([%d%.]+)([KMBTkmbt]?)/?s?")
    if not num then return nil end
    num = tonumber(num)
    if not num then return nil end
    suffix = string.upper(suffix or "")
    local multipliers = { K = 1e3, M = 1e6, B = 1e9, T = 1e12 }
    return num * (multipliers[suffix] or 1)
end

local function findMoneyNearby(gui)
    local parent = gui.Parent
    if not parent then return nil end
    for _, sibling in ipairs(parent:GetChildren()) do
        if sibling ~= gui and (sibling:IsA("TextLabel") or sibling:IsA("TextButton") or sibling:IsA("TextBox")) then
            local money = parseMoneyPerSecond(sibling.Text)
            if money then return money end
        end
    end
    if parent:IsA("TextLabel") or parent:IsA("TextButton") or parent:IsA("TextBox") then
        local money = parseMoneyPerSecond(parent.Text)
        if money then return money end
    end
    return nil
end

local seenAtStartup = {}

local function isDevConsole(gui)
    local current = gui
    while current do
        if current.Name == "DevConsoleMaster" or current.Name == "DevConsoleUI" then return true end
        current = current.Parent
    end
    return false
end

local function getGuiText(gui)
    if gui:IsA("TextLabel") or gui:IsA("TextButton") or gui:IsA("TextBox") then return gui.Text
    elseif gui:IsA("ImageLabel") or gui:IsA("ImageButton") then return gui.Image end
    return ""
end

local function checkForBrainrot(gui, isInitialScan)
    if isDevConsole(gui) then return end
    if not gui:IsA("GuiBase2d") and not gui:IsA("ScreenGui") then return end

    local guiName = string.lower(gui.Name)
    local guiText = string.lower(getGuiText(gui))
    local matched = nil

    for brainrot in pairs(brainrotSet) do
        if guiName:find(brainrot, 1, true) or guiText:find(brainrot, 1, true) then
            matched = brainrot
            break
        end
    end

    if not matched then return end

    local path = gui:GetFullName()

    if isInitialScan then
        seenAtStartup[path] = true
        return
    end

    local money = findMoneyNearby(gui)
    local jobId = tostring(game.JobId)
    recordSteal(matched, money, jobId)
end

local function monitorText(gui)
    if gui:IsA("TextLabel") or gui:IsA("TextButton") or gui:IsA("TextBox") then
        gui:GetPropertyChangedSignal("Text"):Connect(function()
            checkForBrainrot(gui, false)
        end)
    end
end

local function applyMonitoring(container, isInitialScan)
    if isDevConsole(container) then return end
    for _, descendant in ipairs(container:GetDescendants()) do
        if not isDevConsole(descendant) then
            checkForBrainrot(descendant, isInitialScan)
            monitorText(descendant)
        end
    end
    container.DescendantAdded:Connect(function(descendant)
        if isDevConsole(descendant) then return end
        checkForBrainrot(descendant, false)
        monitorText(descendant)
    end)
end

applyMonitoring(CoreGui, true)
applyMonitoring(PlayerGui, true)
