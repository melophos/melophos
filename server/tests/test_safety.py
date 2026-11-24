import pytest

from .safety import UnsafeTestTarget, check_test_server, check_throwaway_name


def test_default_postgres_port_is_refused():
    with pytest.raises(UnsafeTestTarget):
        check_test_server("postgresql://u:p@localhost:5432/postgres")


def test_remote_hosts_are_refused():
    with pytest.raises(UnsafeTestTarget):
        check_test_server("postgresql://u:p@db.example.com:25432/postgres")


def test_the_development_server_is_refused():
    with pytest.raises(UnsafeTestTarget):
        check_test_server("postgresql://u:p@127.0.0.1:25432/x", "postgresql://u:p@127.0.0.1:25432/melophos")


def test_the_throwaway_container_is_accepted():
    check_test_server("postgresql://u:p@127.0.0.1:25432/postgres", "postgresql://u:p@db:5432/melophos")


@pytest.mark.parametrize("name", ["melophos", "postgres", "melophos_dev", "test"])
def test_only_prefixed_names_may_be_dropped(name):
    with pytest.raises(UnsafeTestTarget):
        check_throwaway_name(name)
