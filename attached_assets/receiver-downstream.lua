local WS_URL         = "wss://ws-server-6k5k.onrender.com"
local ENCRYPTION_KEY = "24I19JFSDIPOFJSOARJ324I4QPHI412J41JNFESPAFHJ32I48J23RMONKFDSF093U2JRIPO2;532N4234JI4OOJIFWFJOISJF" 

local SHA256 do
  local band, bor, bxor, bnot, rshift, lshift =
    bit32 and bit32.band or bit.band,
    bit32 and bit32.bor  or bit.bor,
    bit32 and bit32.bxor or bit.bxor,
    bit32 and bit32.bnot or bit.bnot,
    bit32 and bit32.rshift or bit.rshift,
    bit32 and bit32.lshift or bit.lshift

  local K = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  }

  local function rotr(x, n) return bor(rshift(x, n), lshift(x, 32 - n)) end

  local function compress(h, w)
    local a,b,c,d,e,f,g,hh = h[1],h[2],h[3],h[4],h[5],h[6],h[7],h[8]
    for i = 1, 64 do
      local S1    = bxor(rotr(e,6),  rotr(e,11), rotr(e,25))
      local ch    = bxor(band(e,f),  band(bnot(e),g))
      local temp1 = (hh + S1 + ch + K[i] + w[i]) % 0x100000000
      local S0    = bxor(rotr(a,2),  rotr(a,13), rotr(a,22))
      local maj   = bxor(band(a,b),  band(a,c),  band(b,c))
      local temp2 = (S0 + maj) % 0x100000000
      hh=g; g=f; f=e; e=(d+temp1)%0x100000000
      d=c;  c=b; b=a; a=(temp1+temp2)%0x100000000
    end
    h[1]=(h[1]+a)%0x100000000; h[2]=(h[2]+b)%0x100000000
    h[3]=(h[3]+c)%0x100000000; h[4]=(h[4]+d)%0x100000000
    h[5]=(h[5]+e)%0x100000000; h[6]=(h[6]+f)%0x100000000
    h[7]=(h[7]+g)%0x100000000; h[8]=(h[8]+hh)%0x100000000
  end

  function SHA256(data)
    local bytes = {}
    for i = 1, #data do bytes[i] = string.byte(data, i) end
    local len = #bytes
    bytes[len+1] = 0x80
    while #bytes % 64 ~= 56 do bytes[#bytes+1] = 0x00 end
    local bitlen = len * 8
    for i = 7, 0, -1 do bytes[#bytes+1] = math.floor(bitlen / (2^(i*8))) % 256 end

    local h = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
               0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19}

    for chunk = 0, (#bytes/64)-1 do
      local w = {}
      for i = 1, 16 do
        local o = chunk*64 + (i-1)*4
        w[i] = bor(lshift(bytes[o+1],24), lshift(bytes[o+2],16), lshift(bytes[o+3],8), bytes[o+4])
      end
      for i = 17, 64 do
        local s0 = bxor(rotr(w[i-15],7),  rotr(w[i-15],18), rshift(w[i-15],3))
        local s1 = bxor(rotr(w[i-2],17),  rotr(w[i-2],19),  rshift(w[i-2],10))
        w[i] = (w[i-16] + s0 + w[i-7] + s1) % 0x100000000
      end
      compress(h, w)
    end

    local out = {}
    for i = 1, 8 do
      for j = 3, 0, -1 do out[#out+1] = math.floor(h[i] / (2^(j*8))) % 256 end
    end
    return out
  end
end

local function uint32BE(n)
  return string.char(
    math.floor(n / 0x1000000) % 256,
    math.floor(n / 0x10000)   % 256,
    math.floor(n / 0x100)     % 256,
    n % 256
  )
end

local function bytesToStr(t)
  local c = {}
  for i,v in ipairs(t) do c[i] = string.char(v) end
  return table.concat(c)
end

local keyBaseStr = bytesToStr(SHA256(ENCRYPTION_KEY))

local function decrypt(hexStr)
  local cipherBytes = {}
  for hex in hexStr:gmatch("..") do
    cipherBytes[#cipherBytes+1] = tonumber(hex, 16)
  end

  local out = {}
  local blockIndex = -1
  local block = {}

  for i = 1, #cipherBytes do
    local pos      = (i - 1) % 32
    local newBlock = math.floor((i - 1) / 32)
    if newBlock ~= blockIndex then
      blockIndex = newBlock
      block = SHA256(keyBaseStr .. uint32BE(blockIndex))
    end
    out[i] = string.char(bit32.bxor(cipherBytes[i], block[pos + 1]))
  end

  return table.concat(out)
end

local ws = WebSocket.connect(WS_URL)

ws.OnMessage:Connect(function(msg)
  local ok, data = pcall(function()
    return game:GetService("HttpService"):JSONDecode(msg)
  end)
  if ok and data then
    print("[WS] Info:", msg)
    return
  end

  local decrypted = decrypt(msg)
  local success, parsed = pcall(function()
    return game:GetService("HttpService"):JSONDecode(decrypted)
  end)

  if success and parsed then
   --Handle your payload here 
    print("[WS] Received:", decrypted)
  else
    print("[WS] Decrypt failed:", decrypted)
  end
end)

ws.OnClose:Connect(function()
  print("[WS] Connection closed")
end)

print("[WS] Connected to " .. WS_URL)
