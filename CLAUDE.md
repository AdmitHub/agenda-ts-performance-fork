# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview
This is AgendaTS - a TypeScript rewrite of the agenda.js job scheduling library. It provides MongoDB-backed job scheduling for Node.js applications with features like cron scheduling, job priorities, concurrency control, and distributed processing.

## Essential Commands

### Development
```bash
npm run build         # Compile TypeScript to dist/
npm test             # Run full test suite
npm run lint         # Run ESLint
npm run lint-fix     # Auto-fix linting issues
npm run mocha-debug  # Run tests with debugging
npm run mocha-coverage # Generate test coverage report
npm run docs         # Generate TypeDoc documentation
```

### Testing Individual Files
```bash
npx mocha test/agenda.test.ts  # Run specific test file
npx mocha --grep "pattern"     # Run tests matching pattern
```

### Release Process
```bash
npm run release  # Build and create new version with standard-version
```

## Architecture

### Core Components
- **Agenda** (`src/index.ts`): Main class managing job definitions and processing
- **Job** (`src/Job.ts`): Individual job instances with lifecycle management
- **JobDbRepository** (`src/JobDbRepository.ts`): MongoDB abstraction layer
- **JobProcessor** (`src/JobProcessor.ts`): Handles job execution logic
- **JobProcessingQueue** (`src/JobProcessingQueue.ts`): Manages concurrency and processing order

### Key Patterns
- Event-driven architecture extending EventEmitter
- Repository pattern for database operations
- Promise-based async/await throughout
- Full TypeScript typing with interfaces in `src/types/`

### Database Considerations
- Requires MongoDB 4+ 
- Uses mongodb-memory-server for testing
- No automatic index creation - indexes must be created manually for production
- Supports sharding by job name

### Testing Approach
- Mocha + Chai for testing
- Sinon for mocking
- Test files in `/test/*.test.ts`
- Use mongodb-memory-server for database tests
- Coverage reports via NYC

### Important Notes
- Target is ES2019 (Node 10+ compatibility)
- Strict TypeScript mode is enabled (except noImplicitAny)
- Fork mode available for running jobs in child processes
- Progress tracking (0-100%) supported via job.touch()
- Extensive event system for job lifecycle hooks

## How AgendaTS Works

### Core Workflow
1. **Job Definition**: Register job types with processor functions using `agenda.define()`
2. **Job Creation**: Schedule jobs with `agenda.now()`, `agenda.schedule()`, or `agenda.every()`
3. **Background Processing**: JobProcessor continuously discovers, locks, and executes jobs
4. **State Management**: Tracks job lifecycle with MongoDB persistence

### Processing Flow
```
Timer (every processEvery ms) → Find Ready Jobs → Lock Atomically → Queue Locally → Execute → Update State
```

### Job Lifecycle States
- **Created**: Job exists in MongoDB with `nextRunAt` set
- **Locked**: Job atomically locked by a worker (`lockedAt` timestamp)
- **Running**: Job processor function executing
- **Completed**: Job finished successfully (`lastFinishedAt` set)
- **Failed**: Job threw an error (`failCount` incremented)

### Concurrency Control
- **Global**: `maxConcurrency` limits total running jobs (default: 20)
- **Per-Type**: `concurrency` in job definition limits jobs of specific type (default: 5)
- **Locking**: MongoDB atomic operations prevent duplicate execution across workers
- **Lock Expiration**: `lockLifetime` prevents orphaned locks from crashed workers

### Job Storage Schema
Jobs stored in MongoDB with key fields:
- `name`: Job type identifier
- `nextRunAt`: When job should run
- `data`: Job payload/parameters  
- `lockedAt`: Lock timestamp for concurrency control
- `priority`: Execution priority (-20 to 20)
- `repeatInterval`: Cron expression for recurring jobs

### Distributed Processing
- Multiple workers can safely process jobs using MongoDB's atomic locking
- Jobs remain locked until completion or lock expiration  
- Supports horizontal scaling across processes/servers