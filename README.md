# Smart Lost and Found Management System

A college DBMS Level 3 project. This step sets up the Next.js application foundation with TypeScript, App Router, and Tailwind CSS.

Installed versions are pinned in `package.json` and `package-lock.json`: Next.js 16.3.8, React 19.3.0, Tailwind CSS 4.3.3, and TypeScript 6.0.3. Tailwind uses its PostCSS plugin and CSS import; a separate Tailwind configuration file is not needed for this starter.

Tooling compatibility: Next.js's bundled lint plugins currently require ESLint 9 and TypeScript below 6.1. ESLint 9.39.5 is used to satisfy those peer requirements, although npm marks that ESLint release as upstream-unsupported. Revisit this version when the Next.js lint plugins support ESLint 10.

## Local development

Use Node.js 22.13 or newer (the foundation was validated with Node.js 22.19.0) and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The initial home page is a placeholder.

## Validation and production

```sh
npm run lint
npm run typecheck
npm run build
npm start
```

`npm start` serves the production build. Stop a local server with Ctrl+C.

## Configuration

`.env.example` contains a placeholder `DATABASE_URL`, with no real credentials. The current application does not read it or connect to a database, so no local environment file is needed yet. When database integration is added, put real local values in `.env.local`, which is ignored by Git. Never commit credentials or use a `NEXT_PUBLIC_` variable for a database connection string.

## Approved source documents

- Requirements: `docs/DBMS Level 3 Project Requirements.pdf`
- Approved ER design: `docs/lost_found_ER_diagram_revised.drawio`
- Approved relational schema: `docs/lost_found_relational_schema_revised.drawio`

The two original Draw.io files are retained for historical reference only. Use the revised diagrams for future implementation.

## Later implementation

The approved database stack is PostgreSQL 18 with pgvector 0.8.6. Semantic matching will use all-MiniLM-L6-v2, 384-dimensional embeddings stored as `VECTOR(384)`, and cosine similarity on embeddings of `Item_Name + Description`. Similarity identifies potential matches only; it must never establish ownership, approve a claim, or declare a definitive match automatically.

Database integration, authentication, embeddings, matching, claims, handover, and dashboards are deferred to later steps. No database driver or ORM is installed.
