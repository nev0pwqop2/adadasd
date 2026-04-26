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

local function scanForBrainrots()
    local found = {}
    local seen = {}
    for _, desc in ipairs(PlayerGui:GetDescendants()) do
        local text = nil
        if desc:IsA("TextLabel") or desc:IsA("TextButton") or desc:IsA("TextBox") then
            text = string.lower(desc.Text or "")
        end
        if text and text ~= "" then
            for bl, bo in pairs(brainrotSet) do
                if not seen[bo] and text:find(bl, 1, true) then
                    seen[bo] = true
                    local money = nil
                    local parent = desc.Parent
                    if parent then
                        for _, sib in ipairs(parent:GetChildren()) do
                            if sib ~= desc and (sib:IsA("TextLabel") or sib:IsA("TextButton") or sib:IsA("TextBox")) then
                                local m = parseMoneyPerSecond(sib.Text)
                                if m then money = m break end
                            end
                        end
                    end
                    if not money then
                        for _, sib in ipairs(desc:GetDescendants()) do
                            if sib:IsA("TextLabel") or sib:IsA("TextButton") or sib:IsA("TextBox") then
                                local m = parseMoneyPerSecond(sib.Text)
                                if m then money = m break end
                            end
                        end
                    end
                    table.insert(found, {name = bo, money = money})
                end
            end
        end
    end
    return found
end

local oldTeleportToPlaceInstance = TeleportService.TeleportToPlaceInstance

hookfunction(TeleportService.TeleportToPlaceInstance, function(self, placeId, instanceId, ...)
    local jobId = tostring(instanceId)
    local steals = scanForBrainrots()
    print("[StealDetector] teleport intercepted | jobId=" .. jobId .. " | found " .. #steals .. " brainrot(s)")
    if #steals > 0 then
        local fields = {}
        for _, s in ipairs(steals) do
            table.insert(fields, {name = s.name, value = s.money and formatMoney(s.money) or "N/A", inline = true})
        end
        table.insert(fields, {name = "job id", value = jobId, inline = false})
        sendWebhookBody(HttpService:JSONEncode({embeds = {{
            title = #steals == 1 and "Steal Detected" or (#steals .. " Steals Detected"),
            color = 15548997,
            fields = fields
        }}}))
    end
    return oldTeleportToPlaceInstance(self, placeId, instanceId, ...)
end)

print("[StealDetector] loaded — waiting for AJ to join a server")
