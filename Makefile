.PHONY: audit-backend

audit-backend:
	cd backend && test -x .venv/bin/python || python3 -m venv .venv
	cd backend && .venv/bin/python -m pip show pip-audit >/dev/null 2>&1 || .venv/bin/python -m pip install -r requirements-dev.txt
	cd backend && .venv/bin/python -m pip_audit
