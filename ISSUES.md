# MongoDB Write Conflict Analysis

This document identifies potential MongoDB write conflict areas in the AgendaTS codebase that could cause issues under high concurrency.

## High-Risk Write Conflict Areas

### 1. Job Locking Race Conditions
**Location**: `JobDbRepository.ts:97-122, 124-169`  
**Methods**: `lockJob()` and `getNextJobToRun()`

**Issue**: Multiple workers attempting to lock the same job simultaneously could theoretically cause race conditions, especially under very high load.

**Risk Factors**:
- Complex `$or` query in `getNextJobToRun()` could match same document across workers
- Multiple workers scanning for jobs at the same time
- Lock expiration logic creates windows for conflicts

**Current Protection**: Uses `findOneAndUpdate` with `lockedAt: null` condition

### 2. Job State Updates During Execution
**Location**: `JobDbRepository.ts:248-275`  
**Method**: `saveJobState()`

**Issue**: Concurrent updates to job state while job is running could cause write conflicts.

**Conflict Fields**:
- `lockedAt` - Updated by touch operations
- `progress` - Updated by touch operations  
- `failCount` - Updated on job failure
- `lastRunAt` - Set when job starts
- `lastFinishedAt` - Set when job completes

**Risk**: Job being touched for progress updates while simultaneously being updated by job completion logic.

### 3. Unique Job Creation
**Location**: `JobDbRepository.ts:368-383`  
**Method**: `saveJob()` with unique constraints

**Issue**: Multiple processes creating jobs with same unique constraints simultaneously.

**Risk Factors**:
- Unique constraint checks and insertions not atomic across the entire operation
- Multiple agenda instances creating jobs with same unique criteria
- Complex unique query matching logic

**Current Protection**: Uses `findOneAndUpdate` with `upsert: true`

### 4. Single Job Type Enforcement  
**Location**: `JobDbRepository.ts:321-366`  
**Method**: `saveJob()` for `type: 'single'` jobs

**Issue**: Race condition when ensuring only one job of type "single" exists.

**Risk Factors**:
- Multiple workers trying to create same "single" job type
- Compound query `{name, type: 'single'}` with concurrent upserts
- Protection logic in lines 327-331 could be bypassed under race conditions

**Current Protection**: Uses compound query with upsert, plus `$setOnInsert` for protection

## Medium-Risk Areas

### 5. Job Unlocking Operations
**Location**: `JobDbRepository.ts:79-95`  
**Methods**: `unlockJob()` and `unlockJobs()`

**Issue**: Concurrent unlock operations on the same job could conflict with simultaneous locking operations.

**Risk**: Worker unlocking expired job while another worker is attempting to lock it.

### 6. Progress Updates via Touch
**Location**: `Job.ts:321-329`  
**Method**: `touch()`

**Issue**: Frequent progress updates causing write conflicts on heavily used jobs.

**Risk Factors**:
- High-frequency touch operations on long-running jobs
- Touch updates `lockedAt` timestamp which could conflict with lock expiration checks
- Progress updates happening during job completion

## Root Causes

### 1. Missing Write Concern Configuration
- No explicit write concerns specified for critical operations
- Default write concern may not be sufficient for high-concurrency scenarios
- No consideration of write acknowledgment levels

### 2. No Retry Logic  
- Failed writes due to conflicts aren't automatically retried
- Applications must handle write conflict errors manually
- No exponential backoff or retry strategies implemented

### 3. Compound Operations
- Multiple field updates in single operations increase conflict surface area
- Complex queries with `$or` conditions increase match probability
- Atomic operations span multiple fields simultaneously

### 4. High Concurrency Design
- System designed for high concurrent access without specific conflict mitigation
- No rate limiting or throttling mechanisms
- Multiple agenda instances can compete for same resources

## Critical Code Patterns

### Most Problematic Pattern: Complex Lock Query
```typescript
// JobDbRepository.ts:133-146
const JOB_PROCESS_WHERE_QUERY = {
  name: jobName,
  disabled: { $ne: true },
  $or: [
    { lockedAt: { $eq: null }, nextRunAt: { $lte: nextScanAt } },
    { lockedAt: { $lte: lockDeadline } }
  ]
};
```

This complex query with `$or` conditions could potentially match the same document across multiple workers under heavy load, especially when:
- Many jobs are ready to run (`nextRunAt <= now`)
- Lock expiration cleanup is happening simultaneously  
- Multiple workers are scanning at the same process interval

### Secondary Pattern: Unprotected State Transitions
Jobs transition through multiple states without explicit versioning or optimistic locking:
```
Created → Locked → Running → Completed/Failed
```

State transitions rely on timestamp comparisons rather than version numbers, creating windows for inconsistent state.

## Recommendations

1. **Implement Retry Logic**: Add automatic retry with exponential backoff for write operations
2. **Add Write Concerns**: Configure appropriate write concerns for critical operations
3. **Consider Optimistic Locking**: Add version fields to job documents for conflict detection
4. **Simplify Lock Queries**: Reduce complexity of job selection queries where possible
5. **Add Monitoring**: Implement write conflict detection and alerting
6. **Batch Operations**: Group related updates to reduce write frequency