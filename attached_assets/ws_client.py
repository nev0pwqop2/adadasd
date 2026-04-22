import websocket
import json
import hashlib
import struct

WS_URL       = "wss://gigue.onrender.com"
LUARMOR_KEY  = "YOUR_LUARMOR_KEY_HERE"
ENCRYPT_KEY  = "12345678901234567890123456789012"

# ── SHA256 stream cipher (must match relay) ───────────────────────────────────
def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()

def decrypt(hex_str: str) -> str:
    cipher = bytes.fromhex(hex_str)
    key_base = sha256(ENCRYPT_KEY.encode("utf-8"))
    out = bytearray()
    block_index = -1
    block = b""

    for i, b in enumerate(cipher):
        pos = i % 32
        new_block = i // 32
        if new_block != block_index:
            block_index = new_block
            block = sha256(key_base + struct.pack(">I", block_index))
        out.append(b ^ block[pos])

    return out.decode("utf-8")

# ── WebSocket callbacks ───────────────────────────────────────────────────────
def on_message(ws, message):
    # Try plain JSON first (handshake/auth messages)
    try:
        data = json.loads(message)
        if "info" in data:
            print(f"[AUTH] Server: {data['info']}")
            ws.send(json.dumps({"key": LUARMOR_KEY}))
        elif "success" in data:
            print(f"[AUTH] ✅ {data['success']}")
        elif "error" in data:
            print(f"[ERROR] ❌ {data['error']}")
        else:
            print(f"[INFO] {message}")
        return
    except Exception:
        pass

    # Encrypted payload — decrypt it
    try:
        decrypted = decrypt(message)
        parsed = json.loads(decrypted)
        print(f"[LOG] {json.dumps(parsed, indent=2)}")
    except Exception as e:
        print(f"[RAW] {message}")

def on_error(ws, error):
    print(f"[ERROR] {error}")

def on_close(ws, code, msg):
    print(f"[CLOSED] code={code} msg={msg}")

def on_open(ws):
    print(f"[CONNECTED] {WS_URL}")

# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    ws = websocket.WebSocketApp(
        WS_URL,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )
    ws.run_forever()
