# Travel Manager

B2B AI-powered travel coordination platform foundation.

## Setup

```bash
corepack enable
pnpm install
```

## Development

```bash
pnpm dev
```

The web app runs from `apps/web`.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Structure

- `apps/web` - Next.js application with App Router, Tailwind CSS, shadcn/ui setup, Motion, lucide-react, and Zod usage.
- `packages/ui` - Shared UI primitives.
- `packages/core` - Shared product constants and utilities.
- `packages/types` - Shared Zod schemas and TypeScript types.
