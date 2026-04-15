# REFACTOR-002 Refactor backend to pma-go standards

- **status**: pending
- **priority**: P1
- **owner**: (unassigned)
- **createdAt**: 2026-04-15 17:40

## Description

Bring the IncusAdmin Go backend in line with pma-go standards: lint, validation, consistent API responses, and task runner.

Acceptance criteria:
- golangci-lint v2 configured and passing (revive, govet, errcheck, staticcheck)
- go-playground/validator for all handler request structs
- Consistent API responses: `[]` for empty arrays, structured error codes
- Taskfile.yml with lint/test/build/deploy tasks
- Table-driven handler tests for critical paths
- gosec passing

## ActiveForm

Refactoring backend to pma-go standards

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Related plan: PLAN-005 (Phases C, D-backend)
sqlc migration deferred to separate PLAN-006.
