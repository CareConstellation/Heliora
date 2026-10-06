# Contributing to Heliora

Thank you for your interest in contributing! This guide will help you get your local environment running, understand our workflow, and submit high-quality pull requests.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development Setup](#local-development-setup)
3. [Branch Naming Convention](#branch-naming-convention)
4. [Commit Message Format](#commit-message-format)
5. [Pull Request Process](#pull-request-process)
6. [Code Style](#code-style)
7. [Testing Expectations](#testing-expectations)
8. [Issue Reporting](#issue-reporting)
9. [Contact & Maintainer](#contact--maintainer)

---

## Prerequisites

Before you begin, make sure you have the following installed and configured:

| Requirement | Version / Notes |
| --- | --- |
| **Node.js** | v18 or later (LTS recommended) |
| **npm** | v9 or later (bundled with Node.js) |
| **Git** | Any recent version |
| **Freighter browser extension** | Install from [freighter.app](https://www.freighter.app/) — required to sign Stellar transactions in the browser |

### Stellar Testnet Account

You need a funded testnet account to interact with the app locally:

1. Open Freighter and switch the network to **Testnet**.
2. Copy your public key.
3. Visit the [Stellar Testnet Faucet (Friendbot)](https://laboratory.stellar.org/#account-creator?network=test) and fund your account with test XLM.
4. Your account is now ready for local development — no real funds are involved.

---

## Local Development Setup

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/CareConstellation/Heliora.git
cd Heliora

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env.local
# Open .env.local and fill in the required values (see .env.example for guidance)

# 4. Start the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

> **Note:** Make sure your Freighter extension is set to **Testnet** and that `NEXT_PUBLIC_STELLAR_NETWORK=testnet` in your `.env.local`.

---

## Branch Naming Convention

Always branch off from `main`. Use the following prefixes:

| Prefix | When to use |
| --- | --- |
| `feat/` | New feature or enhancement |
| `fix/` | Bug fix |
| `docs/` | Documentation only changes |
| `chore/` | Tooling, config, dependency updates |
| `refactor/` | Code restructuring without behaviour change |
| `test/` | Adding or updating tests |

**Format:** `<prefix>/<issue-number>-short-description`

```bash
# Examples
git checkout -b feat/42-patient-record-sharing
git checkout -b fix/17-wallet-disconnect-loop
git checkout -b docs/21-contributing-guide
```

---

## Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

**Format:**

```
type(scope): concise summary in present tense

Optional body — explain *what* changed and *why*, not *how*.
Wrap lines at 72 characters.

Closes #<issue-number>
```

**Types:**

| Type | When to use |
| --- | --- |
| `feat` | Introduces a new feature |
| `fix` | Fixes a bug |
| `docs` | Documentation changes only |
| `style` | Formatting, whitespace (no logic change) |
| `refactor` | Code change that is neither a fix nor a feature |
| `test` | Adding or correcting tests |
| `chore` | Build process, tooling, dependency updates |

---

## Pull Request Process

1. **Sync your fork** before starting work:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Open a PR against `main`** — never target another feature branch unless explicitly coordinated.

3. **Fill in the PR template** completely:
   - Clear title following the commit format
   - Summary of what changed and why
   - Link to the related issue using `Closes #<issue-number>`
   - Description of how you tested the change

4. **Review requirements:**
   - At least one approving review from a maintainer is required before merging.
   - All CI checks (build, lint, type-check) must pass.
   - Resolve all review comments before requesting a re-review.

5. **Keep PRs focused** — one logical change per PR. Avoid bundling unrelated fixes.

---

## Code Style

The project uses **ESLint** and **Prettier** for consistent formatting.

```bash
# Check for lint errors
npm run lint

# Check formatting
npm run format:check

# Auto-fix formatting
npm run format
```

### Naming Conventions

| Entity | Convention | Example |
| --- | --- | --- |
| React components | PascalCase | `RecordCard.tsx` |
| Hooks | camelCase, `use` prefix | `useRoleRedirect.ts` |
| Zustand stores | camelCase, `use` prefix | `useWalletStore.ts` |
| Utility functions | camelCase | `truncateAddress` |
| Types / Interfaces | PascalCase | `UserRole`, `MedicalRecord` |
| Environment variables | `NEXT_PUBLIC_` prefix for client-side | `NEXT_PUBLIC_API_URL` |

---

## Testing Expectations

- All new features and bug fixes must include relevant tests before a PR can be merged.
- Unit tests live alongside the code they test.
- Run the test suite before pushing:
  ```bash
  npm run test
  ```
- Aim for meaningful coverage of business logic, edge cases, and error states — not just happy paths.

---

## Issue Reporting

### Bug Reports

Open a **Bug Report** issue on GitHub or contact the maintainer:

- A clear, descriptive title
- Steps to reproduce the problem
- Expected vs. actual behaviour
- Browser, OS, and Node.js version
- Relevant console errors or screenshots

---

## Contact & Maintainer

For any questions, security concerns, or direct inquiries:
- **Maintainer:** Aderonke Afolabi
- **Email:** [afolabiaderonke1995@gmail.com](mailto:afolabiaderonke1995@gmail.com)
- **Repository:** [https://github.com/CareConstellation/Heliora](https://github.com/CareConstellation/Heliora)
