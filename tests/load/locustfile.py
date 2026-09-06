"""Bounded HTTP smoke load for local Next.js routes (no websocket clients)."""

from locust import HttpUser, between, task


class SingularityRouteUser(HttpUser):
    wait_time = between(0.1, 0.4)

    @task(4)
    def homepage(self):
        with self.client.get("/", name="GET /", catch_response=True) as response:
            if response.status_code != 200:
                response.failure(f"HTTP {response.status_code}")
            elif b"SINGULARITY" not in response.content:
                response.failure("homepage marker missing")

    @task(1)
    def play_route(self):
        with self.client.get(
            "/play/LOADTEST?solo=1",
            name="GET /play/[code]?solo=1",
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"HTTP {response.status_code}")
            elif b"__next_f.push" not in response.content:
                response.failure("Next.js payload marker missing")
