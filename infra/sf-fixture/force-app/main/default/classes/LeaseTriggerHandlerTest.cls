@IsTest
private class LeaseTriggerHandlerTest {
    @IsTest
    static void defaultsStatusAndStampsHandlerRun() {
        Property__c prop = new Property__c(
            Name = 'Test Property',
            Status__c = 'Available',
            Region__c = 'North',
            Square_Feet__c = 1200,
            Purchase_Price__c = 350000
        );
        insert prop;

        Lease__c lease = new Lease__c(
            Property__c = prop.Id,
            Monthly_Rent__c = 1500,
            Start_Date__c = Date.today(),
            End_Date__c = Date.today().addMonths(12)
        );

        Test.startTest();
        insert lease;
        Test.stopTest();

        lease = [SELECT Status__c, Last_Handler_Run__c FROM Lease__c WHERE Id = :lease.Id];
        System.assertEquals('Draft', lease.Status__c, 'blank Status should default to Draft');
        System.assertNotEquals(null, lease.Last_Handler_Run__c, 'handler should stamp run time');
    }

    @IsTest
    static void preservesExplicitStatus() {
        Property__c prop = new Property__c(Name = 'Test Property 2', Status__c = 'Leased');
        insert prop;

        Lease__c lease = new Lease__c(
            Property__c = prop.Id,
            Status__c = 'Active',
            Monthly_Rent__c = 2100,
            Start_Date__c = Date.today().addDays(-30),
            End_Date__c = Date.today().addMonths(6)
        );
        insert lease;

        lease = [SELECT Status__c FROM Lease__c WHERE Id = :lease.Id];
        System.assertEquals('Active', lease.Status__c, 'explicit Status must not be overwritten');
    }
}
