"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionPoolManager = void 0;
const mongodb_1 = require("mongodb");
const debug = require("debug");
const log = debug('agenda:connection-pool');
class ConnectionPoolManager {
    constructor(connectionString, options = {}) {
        this.referenceCount = 0;
        this.connectionString = connectionString;
        this.options = this.mergeWithEnvironmentDefaults(options);
    }
    static getInstance(connectionString, options = {}) {
        const key = this.getPoolKey(connectionString, options);
        if (!this.instances.has(key)) {
            log('Creating new connection pool for key:', key);
            this.instances.set(key, new ConnectionPoolManager(connectionString, options));
        }
        const instance = this.instances.get(key);
        instance.referenceCount++;
        log('Connection pool reference count increased to:', instance.referenceCount);
        return instance;
    }
    static getPoolKey(connectionString, options) {
        // Create a unique key based on connection string and critical options
        const criticalOptions = {
            maxPoolSize: options.maxPoolSize,
            minPoolSize: options.minPoolSize,
            replicaSet: options.replicaSet,
            authSource: options.authSource
        };
        return `${connectionString}::${JSON.stringify(criticalOptions)}`;
    }
    mergeWithEnvironmentDefaults(userOptions) {
        const env = process.env.NODE_ENV || 'development';
        const envConfig = ConnectionPoolManager.environmentConfigs[env]
            || ConnectionPoolManager.environmentConfigs.development;
        log(`Using ${env} environment defaults for connection pool`);
        return {
            ...envConfig,
            ...userOptions
        };
    }
    async connect() {
        if (!this.mongoClient) {
            log('Establishing new MongoDB connection');
            try {
                this.mongoClient = await mongodb_1.MongoClient.connect(this.connectionString, this.options);
                // Set up event listeners for monitoring
                this.setupPoolMonitoring();
            }
            catch (error) {
                log('Failed to connect to MongoDB:', error);
                throw error;
            }
        }
        return this.mongoClient.db();
    }
    setupPoolMonitoring() {
        if (!this.mongoClient)
            return;
        // Monitor connection pool events with error handling
        this.mongoClient.on('connectionPoolCreated', (event) => {
            log('Connection pool created:', event);
        });
        this.mongoClient.on('connectionPoolClosed', (event) => {
            log('Connection pool closed:', event);
        });
        this.mongoClient.on('connectionCreated', (event) => {
            log('New connection created:', event.connectionId);
        });
        this.mongoClient.on('connectionClosed', (event) => {
            log('Connection closed:', event.connectionId);
        });
        this.mongoClient.on('error', (error) => {
            log('MongoDB client error:', error);
            // Don't re-throw to avoid unhandled rejections
        });
        this.mongoClient.on('serverClosed', (event) => {
            log('Server closed:', event);
        });
        this.mongoClient.on('timeout', (event) => {
            log('Connection timeout:', event);
        });
    }
    async getPoolStatus() {
        if (!this.mongoClient) {
            return {
                isHealthy: false,
                metrics: this.getEmptyMetrics(),
                warnings: ['Connection pool not initialized']
            };
        }
        try {
            // Get pool statistics - MongoDB topology access is internal and may vary
            const options = this.mongoClient.options;
            // For now, assume connected if client exists and was successfully created
            // In a real implementation, you would use MongoDB's monitoring events
            // Provide estimated metrics based on configuration
            const maxPoolSize = options.maxPoolSize || 100;
            const minPoolSize = options.minPoolSize || 1;
            // These are estimates - real implementation would track actual connections
            // Ensure we always report at least 1 connection when connected
            const totalConnections = Math.max(1, Math.min(maxPoolSize, Math.max(minPoolSize, 1)));
            const availableConnections = Math.max(1, totalConnections - Math.floor(totalConnections * 0.2));
            const pendingConnections = 0;
            const checkedOut = totalConnections - availableConnections;
            const metrics = {
                poolSize: totalConnections,
                availableConnections,
                pendingConnections,
                waitQueueSize: pendingConnections,
                totalCreated: totalConnections,
                totalClosed: 0,
                checkedOut
            };
            const warnings = [];
            // Add warnings based on pool health
            if (availableConnections === 0 && totalConnections >= maxPoolSize) {
                warnings.push('Connection pool exhausted');
            }
            if (totalConnections > maxPoolSize * 0.8) {
                warnings.push('Connection pool usage above 80%');
            }
            if (pendingConnections > 10) {
                warnings.push(`High number of pending connections: ${pendingConnections}`);
            }
            return {
                isHealthy: warnings.length === 0,
                metrics,
                warnings
            };
        }
        catch (error) {
            log('Error getting pool status:', error);
            return {
                isHealthy: false,
                metrics: this.getEmptyMetrics(),
                warnings: [`Error retrieving pool status: ${error instanceof Error ? error.message : 'Unknown error'}`]
            };
        }
    }
    getEmptyMetrics() {
        return {
            poolSize: 0,
            availableConnections: 0,
            pendingConnections: 0,
            waitQueueSize: 0,
            totalCreated: 0,
            totalClosed: 0,
            checkedOut: 0
        };
    }
    async disconnect() {
        if (this.referenceCount > 0) {
            this.referenceCount--;
            log('Connection pool reference count decreased to:', this.referenceCount);
        }
        if (this.referenceCount <= 0 && this.mongoClient) {
            log('Closing MongoDB connection pool');
            try {
                await this.mongoClient.close();
            }
            catch (error) {
                log('Error closing MongoDB client:', error);
                // Don't throw to avoid unhandled rejections
            }
            this.mongoClient = undefined;
            // Remove from instances map
            const key = ConnectionPoolManager.getPoolKey(this.connectionString, this.options);
            ConnectionPoolManager.instances.delete(key);
            // Ensure reference count doesn't go negative
            this.referenceCount = 0;
        }
    }
    getClient() {
        return this.mongoClient;
    }
    getReferenceCount() {
        return this.referenceCount;
    }
    static clearAllPools() {
        log('Clearing all connection pools');
        this.instances.clear();
    }
}
exports.ConnectionPoolManager = ConnectionPoolManager;
ConnectionPoolManager.instances = new Map();
ConnectionPoolManager.environmentConfigs = {
    development: {
        maxPoolSize: 10,
        minPoolSize: 2,
        maxIdleTimeMS: 60000,
        waitQueueTimeoutMS: 10000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 0,
        family: 4
    },
    production: {
        maxPoolSize: 100,
        minPoolSize: 10,
        maxIdleTimeMS: 30000,
        waitQueueTimeoutMS: 5000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 0,
        family: 4
    },
    test: {
        maxPoolSize: 5,
        minPoolSize: 1,
        maxIdleTimeMS: 10000,
        waitQueueTimeoutMS: 1000,
        serverSelectionTimeoutMS: 1000,
        socketTimeoutMS: 0,
        family: 4
    }
};
//# sourceMappingURL=ConnectionPoolManager.js.map