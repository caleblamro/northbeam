// Anonymous Apex seed for the Northbeam fixture org.
// Run AFTER `sf project deploy start` and `sf data import tree` (Contacts must exist).
//
// Idempotent: wipes existing Lease__c / Property__c rows first, then creates
// ~150 Properties (mixed record types, deliberately uneven field population to
// exercise Northbeam's populated-% heuristic) and ~400 Leases spread across them.
//
// Population targets (Property):
//   always:  Name, Status, Region, Square_Feet, Purchase_Price, Is_Furnished, RecordType
//   ~80%:    Listed_Date          ~70%: Occupancy_Rate
//   ~65%:    Amenities            ~60%: Manager_Email
//   ~50%:    Description, Last_Inspection
//   ~40%:    Office_Phone         ~30%: Listing_URL
//   0%:      Insurance_Policy_Number, Solar_Score   <- must be SKIPPED by the mapper
// Population targets (Lease):
//   always:  Property (MD), Monthly_Rent, Start_Date, End_Date (validation-safe)
//   ~80%:    Tenant lookup        ~60%: explicit Status (rest defaulted by trigger)
//   ~50%:    Deposit

// Wipe (leases cascade-delete with properties, but be explicit).
delete [SELECT Id FROM Lease__c];
delete [SELECT Id FROM Property__c];

List<Contact> tenants = [SELECT Id FROM Contact ORDER BY CreatedDate LIMIT 50];

Map<String, Schema.RecordTypeInfo> rts =
    Schema.SObjectType.Property__c.getRecordTypeInfosByDeveloperName();
Id residentialRt = rts.get('Residential').getRecordTypeId();
Id commercialRt = rts.get('Commercial').getRecordTypeId();

List<String> statuses = new List<String>{ 'Available', 'Under Contract', 'Leased', 'Off Market' };
List<String> resRegions = new List<String>{ 'North', 'South', 'East', 'West' };
List<String> comRegions = new List<String>{ 'North', 'Central' };
List<String> amenityCombos = new List<String>{
    'Pool;Gym', 'Parking', 'Gym;Parking;Laundry', 'Rooftop;Doorman', 'Pool;Parking;Rooftop', 'Laundry'
};
List<String> resNames = new List<String>{ 'Maple Court', 'Birch Row', 'Cedar Flats', 'Willow Walk' };
List<String> comNames = new List<String>{ 'Commerce Plaza', 'Harbor Point Offices', 'Union Works' };

Integer propCount = 150;
List<Property__c> props = new List<Property__c>();
for (Integer i = 0; i < propCount; i++) {
    Boolean isRes = Math.mod(i, 3) != 0; // ~2/3 residential, ~1/3 commercial
    Property__c p = new Property__c();
    p.RecordTypeId = isRes ? residentialRt : commercialRt;
    p.Name = (isRes
        ? resNames[Math.mod(i, resNames.size())]
        : comNames[Math.mod(i, comNames.size())]) + ' #' + String.valueOf(100 + i);
    p.Status__c = statuses[Math.mod(i, statuses.size())];
    p.Region__c = isRes
        ? resRegions[Math.mod(i, resRegions.size())]
        : comRegions[Math.mod(i, comRegions.size())];
    p.Square_Feet__c = 800 + Math.mod(i * 137, 4200);
    p.Purchase_Price__c = 250000 + Math.mod(i * 9173, 1750000);
    p.Is_Furnished__c = Math.mod(i, 5) == 0;

    Integer bucket = Math.mod(i, 10);
    if (bucket < 8) p.Listed_Date__c = Date.today().addDays(-Math.mod(i * 3, 900));
    if (bucket < 7) p.Occupancy_Rate__c = 40 + Math.mod(i * 7, 60);
    if (Math.mod(i, 20) < 13) p.Amenities__c = amenityCombos[Math.mod(i, amenityCombos.size())];
    if (bucket < 6) p.Manager_Email__c = 'manager' + String.valueOf(i) + '@nbfixture.example.com';
    if (Math.mod(i, 2) == 0) {
        p.Description__c = 'Well-maintained ' + (isRes ? 'residential' : 'commercial')
            + ' property in the ' + p.Region__c + ' region. Fixture record #' + String.valueOf(i) + '.';
        p.Last_Inspection__c = DateTime.now().addDays(-Math.mod(i * 5, 365));
    }
    if (bucket < 4) p.Office_Phone__c = '(555) 03' + String.valueOf(1000 + i).right(2) + '-' + String.valueOf(1000 + i);
    if (bucket < 3) p.Listing_URL__c = 'https://listings.nbfixture.example.com/p/' + String.valueOf(i);
    // Insurance_Policy_Number__c and Solar_Score__c intentionally NEVER populated.

    props.add(p);
}
insert props;

Integer leaseCount = 400;
List<String> leaseStatuses = new List<String>{ 'Active', 'Expired', 'Terminated' };
List<Lease__c> leases = new List<Lease__c>();
for (Integer j = 0; j < leaseCount; j++) {
    Lease__c l = new Lease__c();
    l.Property__c = props[Math.mod(j * 7, props.size())].Id;
    l.Monthly_Rent__c = 900 + Math.mod(j * 211, 4600);
    l.Start_Date__c = Date.today().addDays(-Math.mod(j * 11, 720));
    l.End_Date__c = l.Start_Date__c.addMonths(12 + Math.mod(j, 3) * 6); // always > start (validation rule)
    Integer bucket = Math.mod(j, 10);
    if (bucket < 8 && !tenants.isEmpty()) l.Tenant__c = tenants[Math.mod(j, tenants.size())].Id;
    if (bucket < 6) l.Status__c = leaseStatuses[Math.mod(j, leaseStatuses.size())];
    // remaining 40% left blank -> LeaseTrigger defaults them to 'Draft'
    if (Math.mod(j, 2) == 0) l.Deposit__c = l.Monthly_Rent__c * (1 + Math.mod(j, 2));
    leases.add(l);
}
insert leases;

System.debug('Seeded ' + props.size() + ' properties and ' + leases.size() + ' leases against '
    + tenants.size() + ' contacts.');
