# Out-of-Scope Knowledge Base

Store durable enhancement rejections in `.out-of-scope/<concept>.md`, one file per concept rather than per issue. Each record explains the decision, substantive reasoning, and links all prior requests.

During triage, compare the incoming concept with existing records. Ask the maintainer whether the prior decision still applies. On confirmation, append the request and close it; on reconsideration, update or remove the record and continue normal triage.

```markdown
# Concept name

This project does not support the concept.

## Why this is out of scope

Durable product, domain, or architectural reasoning.

## Prior requests

- #123 - Request title
```

Use this only for rejected enhancements, not bugs or temporary deferrals.
