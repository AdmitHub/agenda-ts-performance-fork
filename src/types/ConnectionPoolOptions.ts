export interface IConnectionPoolMetrics {
	poolSize: number;
	availableConnections: number;
	pendingConnections: number;
	waitQueueSize: number;
	totalCreated: number;
	totalClosed: number;
	checkedOut: number;
}

export interface IConnectionPoolStatus {
	isHealthy: boolean;
	metrics: IConnectionPoolMetrics;
	warnings: string[];
}

export interface IPoolConfig {
	maxPoolSize?: number;
	minPoolSize?: number;
	maxIdleTimeMS?: number;
	waitQueueTimeoutMS?: number;
	serverSelectionTimeoutMS?: number;
	socketTimeoutMS?: number;
	family?: number;
}

export interface IEnvironmentConfig {
	development: IPoolConfig;
	production: IPoolConfig;
	test: IPoolConfig;
}