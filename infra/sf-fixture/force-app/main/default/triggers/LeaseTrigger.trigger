trigger LeaseTrigger on Lease__c (before insert, before update) {
    LeaseTriggerHandler.handle(Trigger.new);
}
