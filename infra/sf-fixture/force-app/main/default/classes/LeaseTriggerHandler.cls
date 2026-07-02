/**
 * Handler for LeaseTrigger (before insert / before update).
 * Deliberately tiny: defaults Status__c and stamps Last_Handler_Run__c so the
 * fixture exercises "org has Apex automation" during a Northbeam migration.
 */
public with sharing class LeaseTriggerHandler {
    public static void handle(List<Lease__c> leases) {
        for (Lease__c lease : leases) {
            if (String.isBlank(lease.Status__c)) {
                lease.Status__c = 'Draft';
            }
            lease.Last_Handler_Run__c = System.now();
        }
    }
}
