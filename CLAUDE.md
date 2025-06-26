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
- **Write Conflict Resilience**: Built-in retry logic with exponential backoff handles MongoDB write conflicts during high-concurrency job locking

### Write Conflict Handling
AgendaTS includes robust write conflict handling for high-concurrency scenarios:

- **Optimized Locking**: Job locking queries are optimized to reduce unnecessary write conflicts
- **Retry Logic**: Automatic retry with exponential backoff (50ms-2000ms delays) for transient conflicts
- **Conflict Detection**: Recognizes MongoDB write conflict errors (codes 112, 11000) and WriteConflict conditions
- **Graceful Degradation**: Failed retries bubble up as normal errors without affecting system stability

The retry mechanism is implemented in:
- `lockJob()`: 3 retries with 50-1000ms delays for job locking operations
- `getNextJobToRun()`: 3 retries with 100-2000ms delays for job discovery operations
- `batchGetNextJobsToRun()`: 3 retries with 100-2000ms delays for batch job operations

### Batch Processing
AgendaTS supports intelligent batch processing to improve performance and reduce write conflicts in high-concurrency scenarios:

#### Configuration Options
```javascript
const agenda = new Agenda({
  mongo: db,
  batchSize: 5,                    // Number of jobs to process in each batch (default: 5)
  enableBatchProcessing: true      // Enable/disable batch processing (default: true)
});
```

#### How Batch Processing Works
- **Intelligent Selection**: JobProcessor automatically determines when to use batch vs single job processing
- **Concurrency Aware**: Batch size is limited by available concurrency slots and lock limits
- **Atomic Operations**: Multiple jobs are locked atomically to prevent race conditions
- **Fallback Strategy**: Automatically falls back to single job processing when batch size is 1 or disabled

#### Batch Processing Logic
1. **Calculate Available Slots**: Considers global `maxConcurrency` and job-specific `lockLimit`
2. **Determine Batch Size**: `min(configuredBatchSize, availableSlots)`
3. **Atomic Locking**: Uses MongoDB `updateMany` to lock multiple jobs simultaneously
4. **Conflict Resilience**: Includes retry logic for handling write conflicts during batch operations

#### Performance Benefits
- **Reduced Database Calls**: Fewer MongoDB operations mean less network overhead
- **Lower Write Conflicts**: Batch operations reduce the probability of multiple workers competing for the same jobs
- **Better Throughput**: More efficient resource utilization in high-concurrency environments
- **Scalability**: Improved performance as the number of concurrent workers increases

#### Configuration Examples

**High-Throughput Setup:**
```javascript
const agenda = new Agenda({
  mongo: db,
  maxConcurrency: 50,
  batchSize: 10,
  enableBatchProcessing: true
});
```

**Conservative Setup:**
```javascript
const agenda = new Agenda({
  mongo: db,
  maxConcurrency: 10,
  batchSize: 3,
  enableBatchProcessing: true
});
```

**Disable Batch Processing:**
```javascript
const agenda = new Agenda({
  mongo: db,
  enableBatchProcessing: false  // Forces single job processing
});
```

#### When Batch Processing is Used
- **Enabled**: `enableBatchProcessing: true` (default)
- **Beneficial**: When calculated batch size > 1
- **Available Capacity**: When concurrency limits allow multiple jobs
- **Job Availability**: When multiple jobs of the same type are ready to run

#### When Single Job Processing is Used
- **Disabled**: `enableBatchProcessing: false`
- **Limited Capacity**: When only 1 concurrency slot is available
- **Small Batch Size**: When `batchSize: 1` is configured
- **No Available Jobs**: When fewer jobs are available than the batch size

### Performance Optimizations
AgendaTS includes several performance optimizations for production environments:

#### MongoDB Index Optimization
When `ensureIndex: true` is set, AgendaTS creates multiple optimized indexes:

```javascript
// Primary job discovery index - optimized for common query patterns
{ name: 1, disabled: 1, nextRunAt: 1, lockedAt: 1, priority: -1 }

// Locked job index with partial filter for cleanup operations
{ lockedAt: 1, name: 1 } // Only indexes documents where lockedAt is not null

// Job status index for history queries
{ name: 1, lastFinishedAt: -1 }

// Legacy index for backward compatibility
{ name: 1, nextRunAt: 1, priority: -1, lockedAt: 1, disabled: 1 }
```

#### Memory Management
The job processing queue now includes memory limits to prevent unbounded growth:

```javascript
// Default queue configuration
const queue = new JobProcessingQueue(agenda, maxQueueSize = 10000);

// Queue monitoring
queue.getUtilization(); // Returns 0-100% usage
queue.isNearCapacity(threshold = 80); // Returns true if queue is filling up

// Queue overflow event
agenda.on('queueOverflow', ({ jobName, queueSize, maxSize }) => {
  console.warn(`Queue overflow: ${jobName}, size: ${queueSize}/${maxSize}`);
});
```

#### Optimized Job Tracking
Internal job collections use Maps for O(1) lookups instead of O(n) array searches:

- Running jobs tracked with both array and Map
- Locked jobs tracked with both array and Map  
- Fast `isJobRunning()` check for duplicate detection
- Efficient job removal without array scanning

#### MongoDB Connection Pooling
Default optimized connection settings:

```javascript
const agenda = new Agenda({
  db: {
    address: mongoConnectionString,
    options: {
      maxPoolSize: 100,           // Maximum connections in pool
      minPoolSize: 10,            // Minimum connections to maintain
      maxIdleTimeMS: 30000,       // Close idle connections after 30s
      waitQueueTimeoutMS: 5000,   // Max wait time for connection
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 0,         // Never timeout socket operations
      family: 4                   // Use IPv4 (skip IPv6 unless needed)
    }
  }
});
```

#### Memory Leak Prevention
Comprehensive event listener cleanup on stop:

- All job-specific event listeners removed (`start:jobName`, `success:jobName`, etc.)
- General event listeners cleaned up (`processJob`, `queueOverflow`)
- Proper resource disposal prevents memory leaks in long-running applications

### Performance Tuning Guide

#### For High-Throughput Systems
```javascript
const agenda = new Agenda({
  mongo: db,
  maxConcurrency: 100,          // Process many jobs concurrently
  defaultConcurrency: 10,       // Higher per-job concurrency
  batchSize: 20,               // Larger batches for efficiency
  enableBatchProcessing: true,
  processEvery: '1 second',    // Frequent job discovery
  defaultLockLifetime: 300000  // 5 minutes for long-running jobs
});
```

#### For Resource-Constrained Systems
```javascript
const agenda = new Agenda({
  mongo: db,
  maxConcurrency: 5,           // Limit concurrent processing
  defaultConcurrency: 1,       // Single job concurrency
  batchSize: 3,               // Small batches
  processEvery: '10 seconds', // Less frequent polling
  defaultLockLifetime: 60000  // 1 minute timeout
});
```

#### For Mixed Workloads
```javascript
// Define high-priority jobs with specific settings
agenda.define('critical-job', { 
  priority: 10, 
  concurrency: 5,
  lockLifetime: 120000 
}, handler);

// Define batch jobs with relaxed settings
agenda.define('batch-job', { 
  priority: -10, 
  concurrency: 1,
  lockLifetime: 600000  // 10 minutes
}, handler);
```

### Monitoring and Debugging

#### Queue Status Monitoring
```javascript
const status = await agenda.getRunningStats();
console.log({
  queueUtilization: agenda.jobQueue.getUtilization(),
  totalQueueSize: status.totalQueueSizeDB,
  runningJobs: status.runningJobs.length,
  lockedJobs: status.lockedJobs.length,
  queuedJobs: status.queuedJobs
});
```

#### Performance Events
```javascript
// Monitor queue overflow
agenda.on('queueOverflow', (details) => {
  metrics.increment('agenda.queue.overflow', { job: details.jobName });
});

// Track job processing times
agenda.on('start', (job) => {
  job.attrs._startTime = Date.now();
});

agenda.on('complete', (job) => {
  const duration = Date.now() - job.attrs._startTime;
  metrics.histogram('job.duration', duration, { name: job.attrs.name });
});
```