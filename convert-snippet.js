// freeze all fields in incident
current.u_converted_to_task = true; // fields set to readonly by UI policy

// Incident state = awaiting
// Awaiting = Change
current.incident_state = 4;
current.u_awaiting = 3;

// Create new task
var gr = new GlideRecord("task");
gr.initialize();

// Copy fields task | incident
	// External reference = Number
	// Opened = Opened
	// Opened by = Opened by
	// Description = Description
	// Assignment group = Assignment group
	// Firm = Firm
	// Installation ID = Installation ID
gr.parent = current;
gr.opened_at = current.opened_at;
gr.opened_by = current.opened_by;
gr.short_description = current.short_description;
gr.assignment_group = current.assignment_group;
gr.company = current.u_individual_firm_caller_name;
gr.cmdb_ci = current.cmdb_ci;

// Manual input
	// Project type
	// Project
	// Scheduling fields
	// Cost fields

// Submit
var id = gr.insert();

// Insert worknote in INC : "Converted to TASK (task number)"
current.work_notes = "Converted to TASK " + gr.number;

current.update();
gs.addInfoMessage("Please manually fill in the Project type, Project, Scheduling and Cost fields");

// Redirect
var redirect = new GlideRecord("task");
redirect.get(id);
action.setRedirectURL(redirect);

// Send mail to Incident Firm to cancel incident
gs.eventQueue("incident.cancel", current, null, null);

// Send mail to Client: "Incident (number) converted to Task (number)"
gs.eventQueue("incident.converted_to_task", current, gr.number, null);
