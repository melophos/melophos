"""A tiny local HTTP receiver that records what it gets and answers as told."""

import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Receiver:
    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.status = 200
        self.delay = 0.0
        self.location: str | None = None
        self.huge = False
        self.silent = False  # accept and never answer
        receiver = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("content-length", 0))
                body = self.rfile.read(length)
                receiver.requests.append({"headers": dict(self.headers), "body": body, "path": self.path})
                if receiver.silent:
                    time.sleep(30)
                    return
                if receiver.delay:
                    time.sleep(receiver.delay)
                self.send_response(receiver.status)
                if receiver.location:
                    self.send_header("Location", receiver.location)
                if receiver.huge:
                    self.send_header("Content-Length", str(50 * 1024 * 1024))
                self.end_headers()
                if receiver.huge:
                    try:
                        for _ in range(50):
                            self.wfile.write(b"x" * 1024 * 1024)
                    except OSError:
                        pass

            def log_message(self, *args):
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.server.server_port}/hook"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
