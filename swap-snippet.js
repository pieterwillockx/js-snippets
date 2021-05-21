executeSwap: function(ciClass, oldCI, newCI, updateStatus,
        updateAssignedTo, updateLocation, updateRelationships, updateSoftwares, leaseID, substatus) {

        gs.log("executeSwap substatus = " + substatus);

        var oldCIObject = new GlideRecord(ciClass);
        oldCIObject.get(oldCI);
        var newCIObject = new GlideRecord(ciClass);
        newCIObject.get(newCI);
        var oldAsset = new GlideRecord("alm_hardware");

        if (updateStatus == true) {
            newCIObject.install_status = 1; // Installed
            oldCIObject.install_status = 2; // In stock

            // set new install substatus
            if (substatus != "") {
                oldAsset.get(oldCIObject.asset);
                oldAsset.install_status = 6;
                oldAsset.substatus = substatus;
            }
        }

        if (updateLocation == true) {
            newCIObject.location = oldCIObject.location;
            newCIObject.u_location_comments = oldCIObject.u_location_comments;
            oldCIObject.location = "e53577190a3229610109e5074bf21095"; // 314/0 (EL)
            oldCIObject.u_location_comments = "";
        }


        if (oldCIObject.sys_class_name == "cmdb_ci_comm") {
            newCIObject.phone_number = oldCIObject.phone_number;
            oldCIObject.phone_number = "";
        }

        // clear budgetcenter and activity in the old ci and copy it to the new ci
        newCIObject.u_budget_center = oldCIObject.u_budget_center;
        newCIObject.u_activity = oldCIObject.u_activity;
        oldCIObject.u_budget_center = "";
        oldCIObject.u_activity = "";

        // set environment of old ci to new ci, set old ci environment to PRO
        newCIObject.u_environment = oldCIObject.u_environment;
        oldCIObject.u_environment = "pro";

        if (ciClass == "cmdb_ci_computer") {
            // init cart: all requested items ordered on the same cart to have a mutual request object
            var cartId = GlideGuid.generate(null);
            var cart = new Cart(cartId);

            // create SWAP request
            var item = cart.addItem('a6d8325c64d520109a6b4d149b12d109', 1);

            // fill in request variables
            cart.setVariable(item, "u_old_computer", oldCIObject.sys_id);
            cart.setVariable(item, "u_new_computer", newCIObject.sys_id);
            cart.setVariable(item, "u_requested_for", oldCIObject.assigned_to.sys_id.toString());

            // loop over all entitlements
            var allocations = this.getAllocations(oldCIObject);

            // save amount of allocations to return to caller
            var rowCountTransferred = 0;
			var rowCountNotTransferred = 0;
			
			// reporting of software name
			var report = "Softwares:\n";

            while (allocations.next()) {
                // create task: Push software to device from old ci to new ci
                // IF sriCreated (package NOT retired), add 1 to rowCountTransferred, else add 1 to rowCountNotTransferred
				var vals = this.createInstallTask(oldCIObject, newCIObject, allocations, cart, "Yes", "No");
				var parsedVals = JSON.parse(vals);
				var sriCreated = parsedVals.sriCreated;
				report += parsedVals.report;
				
                if (sriCreated) {
                    rowCountTransferred++;
					gs.log("In executeSwap, rowCountTransferred = " + rowCountTransferred);
                } else {
					rowCountNotTransferred++;
					
					// remove allocation so it doesn't get transferred
					allocations.deleteRecord();
					
					gs.log("In executeSwap, rowCountNotTransferred = " + rowCountNotTransferred);
				}
            }

            // place orders
            var rc = cart.placeOrder();
        }


        // do this after creating SWAP tasks because assigned_to is needed in that function
        if (updateAssignedTo == true) {
            newCIObject.assigned_to = oldCIObject.assigned_to;
            oldCIObject.assigned_to = ""; // Assigned to is emptied
        }

        this.updateCIRelationships(oldCI, newCI, "cmdb_rel_ci", "parent");
        this.updateCIRelationships(oldCI, newCI, "cmdb_rel_ci", "child");
        if (updateSoftwares == true) {
            this.updateSoftwares(oldCI, newCI);
        }
        if (!leaseID.nil()) {
            //gs.log("CMDBHardwareSwapUtils in lease : " + leaseID);
            var asset = new GlideRecord("alm_hardware");
            asset.addQuery("ci=" + newCI);
            asset.query();
            if (asset.next()) {
                asset.u_ref_lease_contract = leaseID;
                //asset.setWorkflow(false);
                asset.update();
            }
        }

        oldCIObject.update();
        newCIObject.update();

        oldAsset.update();

        if (ciClass == "cmdb_ci_computer") {
            var vals1 = {};
            vals1.requestID = rc.sys_id.toString();
            vals1.amountOfSoftwaresTransferred = rowCountTransferred;
			vals1.amountOfSoftwaresNotTransferred = rowCountNotTransferred;
			vals1.report = report;

            return JSON.stringify(vals1);
        } else {
            return;
        }
    },

isCommunicationDevice: function() {
        var sys_id = this.getParameter('sysparm_sys_id');
        var answer = false;

        var oldCIObject = new GlideRecord("cmdb_ci");
        oldCIObject.get(sys_id);

        if (oldCIObject.sys_class_name == "cmdb_ci_comm") {
            answer = true;
        }

        return answer;
    },

getAllocations: function(CIObject) {
        gs.log("In getAllocations -> first line");

        var allocations = new GlideRecord("alm_entitlement_asset");
        allocations.addQuery('allocated_to', CIObject.sys_id);
        allocations.query();

        gs.log("In getAllocations -> before return");

        return allocations;
    },

    // for given allocation, create SRI with item "Install software from NBB Catalog"
    createInstallTask: function(oldCIObject, newCIObject, allocation, cart, isSwapProcedure, isRelaunchProcedure) {

        var sriCreated = false;
		var report = "";

        // check if license retired
        var license = new GlideRecord("alm_license");
        license.addQuery("sys_id", allocation.licensed_by.sys_id.toString());
        license.query();
        if (license.next() && license.state != '14') {

            // get u_w7_software from allocation
            var sccmAppName;
            var sccmApp = new GlideRecord("u_soft_package");
            sccmApp.addQuery('u_software_license', allocation.licensed_by.sys_id.toString());
            sccmApp.addQuery('u_active', true);

            // get most recent SCCM App according to 'Created' date, then limit to only 1 record
            sccmApp.orderByDesc('sys_created_on');
            sccmApp.setLimit(1);

            sccmApp.query();

            if (sccmApp.next()) {

                var w7_package = new GlideRecord("u_w7_software");
                w7_package.addQuery("sys_id", sccmApp.u_package.sys_id.toString());
                w7_package.query();

                if (w7_package.next() && w7_package.u_objectpath != "/RETIRED") {

                    sriCreated = true;
					report += w7_package.u_name + " -> TO TRANSFER\n";

                    var item = cart.addItem('979ad1354d4103009a6be80389615fd8', 1);

                    // fill in request variables
                    cart.setVariable(item, "opened_by", oldCIObject.assigned_to.sys_id);
                    cart.setVariable(item, "estimated_delivery");

                    // fill in item variables (u_requested_for auto filled in with current user, we want the workstation owner)
                    cart.setVariable(item, "u_requested_for", oldCIObject.assigned_to.sys_id.toString());
                    cart.setVariable(item, "workstation", newCIObject.sys_id.toString());
                    cart.setVariable(item, "u_is_swap_procedure", isSwapProcedure); //This flag makes the workflow ignore approval flow
                    cart.setVariable(item, "u_is_relaunch_procedure", isRelaunchProcedure); // makes the workflow ignore approval flow and license checks

                    // set package name as variable of task
                    cart.setVariable(item, "u_package", sccmApp.u_package.sys_id.toString());
                } else {
					report += w7_package.u_name + " -> RETIRED\n";
				}
            }
        }

		var vals = {};
		vals.sriCreated = sriCreated;
		vals.report = report;
		
		return JSON.stringify(vals);
    },

executeRelaunch: function(CIObject) {
        // loop over all entitlements
        var allocations = this.getAllocations(CIObject);

        var cartId = GlideGuid.generate(null);
        var cart = new Cart(cartId);
        var item = cart.addItem('87b46ea420d420109a6be0c7d4a68268', 1);

        // fill in request variables
        cart.setVariable(item, "opened_by", CIObject.assigned_to.sys_id);

        gs.log("In executeRelaunch -> Device owner = " + CIObject.assigned_to.sys_id.toString());

        // fill in item variables (u_requested_for auto filled in with current user, we want the workstation owner)
        cart.setVariable(item, "u_requested_for", CIObject.assigned_to.sys_id.toString());
        cart.setVariable(item, "workstation", CIObject.sys_id.toString());

        while (allocations.next()) {
            // create task: Push software to device from old ci to new ci
            this.createInstallTask(CIObject, CIObject, allocations, cart, "No", "Yes");
        }

        var rc = cart.placeOrder();
    }
}
