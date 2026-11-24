def test_metrics_are_off_until_a_token_is_set(client):
    assert client.get("/metrics/").status_code == 404


def test_health_reports_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_metrics_need_the_token_when_one_is_set(settings):
    from dataclasses import replace

    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(replace(settings, metrics_token="metrics-token-value"))) as c:
        assert c.get("/metrics/").status_code == 401
        assert c.get("/metrics/", headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert c.get("/metrics/", headers={"Authorization": "Bearer metrics-token-value"}).status_code == 200
