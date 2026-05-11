import { RuleEngine } from '../ruleEngine';
import { AuditLogger } from '../auditLogger';
import { PerformanceMonitor } from '../performanceMonitor';
export declare function getRuleEngine(): RuleEngine;
export declare function getAuditLogger(): AuditLogger;
export declare function getPerfMonitor(): PerformanceMonitor;
export declare function registerSystemIpc(): void;
