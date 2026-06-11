## Memory System (MemoryKit)

This project uses MemoryKit for persistent memory across conversations.

### Before Starting Any Task
- Call `retrieve_context` with the task description to check for relevant past decisions, bugs, or patterns

### When Completing Work
- Use `store_memory` to save architectural decisions (facts layer)
- Use `store_memory` to record bugs and fixes (episodes layer)
- Use `store_memory` to document patterns and conventions (procedures layer)

### Memory Best Practices
- Include the reasoning (WHY), not just the decision (WHAT)
- Reference related files when relevant
- Use descriptive tags for better retrieval
