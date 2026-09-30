def test_metrics_are_exposed(client):
    response = client.get("/metrics/")
    assert response.status_code == 200
    assert "python_info" in response.text


def test_health_reports_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
