# Contributing

First off, thank you for taking the time to contribute to the Stacks ecosystem!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/stacksjs/analytics.git
cd analytics

# Install dependencies
bun install

# Run tests
bun test

# Run linter
bun run lint

# Type check
bun run typecheck

# Build
bun run build
```

## Pull Request Process

1. Fork the repository and create your branch from `main`
2. Make your changes and ensure tests pass
3. Update documentation if needed
4. Submit a pull request

## Commit Messages

We use semantic commit messages. Your commit messages should follow this format:

```
type(scope): description

[optional body]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## Code Style

- Use TypeScript
- Follow the existing code style (enforced by ESLint)
- Write tests for new features
- Keep changes focused and atomic

## Questions?

Feel free to open an issue or reach out on Discord.
