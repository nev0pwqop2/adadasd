import requests
import time
import random
import threading
from datetime import datetime

WORKER = "https://calm-night-4622.yohalvata.workers.dev"
URL = f"{WORKER}/railway1"
PARAMS = {"client_id": "2519904148", "_t": "TqH9XdfzYQ459v1tdfsFiCQKAY9C8PAm"}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
]

REFERERS = [
    "https://blox-fruits.fandom.com/",
    "https://www.google.com/",
    "https://discord.com/",
    "https://www.roblox.com/",
]

stats = {"ok": 0, "rate": 0, "err": 0, "total": 0}
lock = threading.Lock()

def make_headers():
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": random.choice(REFERERS),
        "Origin": "https://www.roblox.com",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Connection": "keep-alive",
    }

def make_params():
    p = dict(PARAMS)
    p["_ts"] = str(int(time.time() * 1000))
    p["_r"] = str(random.randint(100000, 999999))
    return p

def worker_thread(interval_ms, thread_id, max_requests):
    session = requests.Session()
    count = 0
    while count < max_requests:
        try:
            r = session.get(URL, params=make_params(), headers=make_headers(), timeout=5)
            ts = datetime.now().strftime('%H:%M:%S.%f')[:-3]
            with lock:
                stats["total"] += 1
                if r.status_code == 200:
                    stats["ok"] += 1
                    data = r.json()
                    has_job = data.get("has_job", False)
                    pet = data.get("pet_name", "none")
                    print(f"[{ts}] T{thread_id} 200 has_job={has_job} pet={pet}")
                elif r.status_code == 429:
                    stats["rate"] += 1
                    print(f"[{ts}] T{thread_id} 429 rate limited")
                else:
                    stats["err"] += 1
                    print(f"[{ts}] T{thread_id} {r.status_code} {r.text[:80]}")
        except Exception as e:
            with lock:
                stats["err"] += 1
                print(f"[{datetime.now().strftime('%H:%M:%S')}] T{thread_id} ERROR {e}")
        count += 1
        time.sleep(interval_ms / 1000)

def run_test(interval_ms, threads, requests_each):
    print(f"\n{'='*55}")
    print(f"  interval={interval_ms}ms  threads={threads}  requests={requests_each}")
    print(f"  effective rate = {threads * (1000/interval_ms):.1f} req/s")
    print(f"{'='*55}")
    stats["ok"] = stats["rate"] = stats["err"] = stats["total"] = 0
    workers = []
    for i in range(threads):
        t = threading.Thread(target=worker_thread, args=(interval_ms, i+1, requests_each), daemon=True)
        workers.append(t)
        time.sleep(0.05)
        t.start()
    for t in workers:
        t.join()
    total = stats["total"] or 1
    print(f"\n  Results: {stats['ok']} OK / {stats['rate']} 429 / {stats['err']} ERR out of {stats['total']}")
    print(f"  Success rate: {stats['ok']/total*100:.1f}%")

if __name__ == "__main__":
    print("Railway1 rate-limit probe — testing various intervals & thread counts\n")

    # Phase 1: find lowest interval that works (single thread)
    print("Phase 1: Finding minimum working interval (single thread)")
    for ms in [2000, 1000, 500, 250, 100]:
        run_test(ms, threads=1, requests_each=5)
        time.sleep(2)

    # Phase 2: try multi-thread at the safer intervals
    print("\nPhase 2: Multi-thread stress test")
    for threads in [2, 4, 8]:
        run_test(500, threads=threads, requests_each=5)
        time.sleep(3)

    # Phase 3: sustained spam at best found interval
    print("\nPhase 3: Sustained 30-second spam at 1000ms single-thread")
    run_test(1000, threads=1, requests_each=30)
