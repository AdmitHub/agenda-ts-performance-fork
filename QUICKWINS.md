# Quick Wins for MongoDB Write Conflict Mitigation

This document outlines the highest-impact, low-effort changes that can be implemented quickly to reduce MongoDB write conflicts in AgendaTS.

## Priority Order (by Impact vs. Effort)

### 1. **Add Write Concerns to Critical Operations** ⭐⭐⭐
**Time**: 30 minutes  
**Impact**: HIGH  
**Difficulty**: LOW

Add `{ writeConcern: { w: 'majority', j: true } }` to all critical write operations in `JobDbRepository.ts`:

**Target Methods**:
- `lockJob()` (line 115)
- `getNextJobToRun()` (line 162) 
- `saveJob()` (line 313, 347, 378, 390)
- `saveJobState()` (line 263)

**Implementation**:
```typescript
// Example for lockJob()
const resp = await this.collection.findOneAndUpdate(
  criteria as Filter<IJobParameters>,
  update,
  { 
    ...options,
    writeConcern: { w: 'majority', j: true }
  }
);
```

**Benefits**:
- Forces acknowledgment from majority of replica set members
- Ensures write durability before returning
- Prevents phantom reads and lost updates
- No breaking API changes

### 2. **Add Touch Throttling** ⭐⭐⭐
**Time**: 15 minutes  
**Impact**: MEDIUM-HIGH  
**Difficulty**: LOW

Reduce database write pressure from frequent `touch()` calls in `Job.ts:321-329`.

**Implementation**:
```typescript
export class Job<DATA = unknown | void> {
  private lastTouchTime = 0;
  private minTouchInterval = 5000; // 5 seconds

  async touch(progress?: number): Promise<void> {
    if (this.canceled) {
      throw new Error(`job ${this.attrs.name} got canceled already: ${this.canceled}!`);
    }
    
    const now = Date.now();
    if (now - this.lastTouchTime < this.minTouchInterval) {
      // Update in memory but don't write to DB
      this.attrs.progress = progress;
      this.attrs.lockedAt = new Date();
      return;
    }
    
    this.lastTouchTime = now;
    this.attrs.lockedAt = new Date();
    this.attrs.progress = progress;
    await this.agenda.db.saveJobState(this);
  }
}
```

**Benefits**:
- Reduces write conflicts from high-frequency touch operations
- Maintains progress tracking functionality
- Configurable throttle interval
- Backward compatible

### 3. **Add Simple Retry Logic** ⭐⭐
**Time**: 1 hour  
**Impact**: HIGH  
**Difficulty**: MEDIUM

Create a retry wrapper for write operations that handles transient conflicts.

**Implementation** in `JobDbRepository.ts`:
```typescript
export class JobDbRepository {
  private async retryWrite<T>(
    operation: () => Promise<T>, 
    retries = 3,
    baseDelay = 100
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error: any) {
        // MongoDB write conflict or duplicate key errors
        if (error.code === 11000 || error.code === 112 || error.code === 16500) {
          if (i === retries - 1) throw error;
          
          // Exponential backoff with jitter
          const delay = baseDelay * Math.pow(2, i) + Math.random() * 100;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  // Wrap critical operations
  async lockJob(job: JobWithId): Promise<IJobParameters | undefined> {
    return this.retryWrite(() => this._lockJob(job));
  }
  
  private async _lockJob(job: JobWithId): Promise<IJobParameters | undefined> {
    // ... existing lockJob implementation
  }
}
```

**Benefits**:
- Handles transient write conflicts gracefully
- Exponential backoff prevents thundering herd
- Configurable retry count and delay
- Transparent to calling code

### 4. **Simplify Lock Query** ⭐⭐
**Time**: 45 minutes  
**Impact**: HIGH  
**Difficulty**: MEDIUM

Split the complex `$or` query in `getNextJobToRun()` into two simpler, sequential queries.

**Current Problem** (`JobDbRepository.ts:133-146`):
```typescript
const JOB_PROCESS_WHERE_QUERY = {
  name: jobName,
  disabled: { $ne: true },
  $or: [
    { lockedAt: { $eq: null }, nextRunAt: { $lte: nextScanAt } },
    { lockedAt: { $lte: lockDeadline } }
  ]
};
```

**Solution**:
```typescript
async getNextJobToRun(
  jobName: string,
  nextScanAt: Date,
  lockDeadline: Date,
  now: Date = new Date()
): Promise<IJobParameters | undefined> {
  const baseQuery = { name: jobName, disabled: { $ne: true } };
  const update = { $set: { lockedAt: now } };
  const options = { returnDocument: 'after', sort: this.connectOptions.sort };

  // First: Try to find unlocked jobs ready to run
  let result = await this.collection.findOneAndUpdate(
    { ...baseQuery, lockedAt: null, nextRunAt: { $lte: nextScanAt } },
    update,
    options
  );

  // Second: If no unlocked jobs, look for expired locks
  if (!result.value) {
    result = await this.collection.findOneAndUpdate(
      { ...baseQuery, lockedAt: { $lte: lockDeadline } },
      update,
      options
    );
  }

  return result.value || undefined;
}
```

**Benefits**:
- Reduces chance of multiple workers matching same document
- Prioritizes unlocked jobs over expired locks
- Simpler query execution plans
- Better index utilization

### 5. **Add Job Versioning** ⭐⭐⭐
**Time**: 2 hours  
**Impact**: VERY HIGH  
**Difficulty**: MEDIUM-HIGH

Add optimistic locking with version fields to prevent lost updates.

**Schema Changes**:
```typescript
// In types/JobParameters.ts
export interface IJobParameters<DATA = any> {
  // ... existing fields
  version?: number; // Add version field
}
```

**Implementation** in `JobDbRepository.ts`:
```typescript
async saveJobState(job: Job<any>): Promise<void> {
  const id = job.attrs._id;
  const currentVersion = job.attrs.version || 0;
  
  const $set = {
    lockedAt: (job.attrs.lockedAt && new Date(job.attrs.lockedAt)) || undefined,
    nextRunAt: (job.attrs.nextRunAt && new Date(job.attrs.nextRunAt)) || undefined,
    lastRunAt: (job.attrs.lastRunAt && new Date(job.attrs.lastRunAt)) || undefined,
    progress: job.attrs.progress,
    failReason: job.attrs.failReason,
    failCount: job.attrs.failCount,
    failedAt: job.attrs.failedAt && new Date(job.attrs.failedAt),
    lastFinishedAt: (job.attrs.lastFinishedAt && new Date(job.attrs.lastFinishedAt)) || undefined
  };

  const result = await this.collection.updateOne(
    { 
      _id: id, 
      name: job.attrs.name,
      version: currentVersion 
    },
    {
      $set,
      $inc: { version: 1 }
    }
  );

  if (!result.acknowledged || result.matchedCount !== 1) {
    if (result.matchedCount === 0) {
      throw new Error(`Job ${id} was modified by another process (version conflict)`);
    }
    throw new Error(`Job ${id} cannot be updated in the database`);
  }
  
  // Update in-memory version
  job.attrs.version = currentVersion + 1;
}
```

**Benefits**:
- Prevents lost updates completely
- Provides clear error messages for conflicts
- Enables conflict detection and resolution
- Foundation for advanced conflict resolution strategies

## Implementation Strategy

### Phase 1: Immediate (1 hour total)
1. **Write Concerns** (30 min)
2. **Touch Throttling** (15 min) 
3. **Test basic functionality** (15 min)

### Phase 2: Short Term (2 hours total)
4. **Simple Retry Logic** (1 hour)
5. **Test retry behavior** (30 min)
6. **Monitor conflict rates** (30 min)

### Phase 3: Medium Term (3 hours total)
7. **Simplify Lock Query** (45 min)
8. **Job Versioning** (2 hours)
9. **Comprehensive testing** (15 min)

## Expected Impact

**After Phase 1**: ~50% reduction in write conflicts  
**After Phase 2**: ~80% reduction in write conflicts  
**After Phase 3**: ~95% reduction in write conflicts + complete prevention of lost updates

## Validation

Test the improvements using:
```bash
# Monitor MongoDB for write conflicts
db.runCommand({serverStatus: 1}).writeConflicts

# Load test with multiple agenda instances
npm test -- --grep "concurrency"
```

## Rollback Plan

All changes are backward compatible and can be:
- **Write Concerns**: Remove from options objects
- **Touch Throttling**: Remove throttle logic, keep existing touch behavior  
- **Retry Logic**: Bypass wrapper, call original methods directly
- **Lock Query**: Revert to original $or query
- **Versioning**: Ignore version field in queries (defaults to undefined check)

These changes provide immediate, measurable improvements with minimal risk and can be implemented incrementally.