const cheerio = require('cheerio');
const request = require('request').defaults({jar: true});
const Promise = require('bluebird');
const querystring = require('querystring');
const colors = require('colors');
const sleep = require('sleep');

var registered = [];

const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('house-seven-event-booker-db.json');
const db = low(adapter)

db.defaults({events: []}).write()

function makeRequest(method, endpoint, data){
	return new Promise(function(res,rej){

		sleep.sleep(2);

		if(method == 'GET'){
			request(endpoint, function(error, response, body) {
				return res(body);
			});
		}else{
			var formData = querystring.stringify(data);
			var contentLength = formData.length;

			var config = {
				url:endpoint,
				headers: {
					'Content-Length': contentLength,
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: formData
			} 

			request.post(config, function(err,httpResponse,body){
				return res(body);
			})
		}
	})
}

function getAuthToken(html){
	const $ = cheerio.load(html);
	const element = $('input[name="authenticity_token"]');
	return element.attr('value');
}

function registerForEvent(type, id){

	if(registered.indexOf(type+'-'+id) != -1){
		console.error(("[x] ("+id+" - "+type+") You have already registered for this event.").red);
		return;
	}

	var check = db.get('events').find({id: id}).value();
	if(check){
		console.log(("[x] Already registered for ["+id+"]").red)
		return;
	}

	var count; 

	makeRequest('GET', 'https://www.houseseven.com/'+type+'/'+id+'/booking')
	.then(function(html){
		var token = getAuthToken(html);

		const $ = cheerio.load(html);
		
		const cancelButton = $('a.cancellation').get(0);
		if(cancelButton){
			throw "You have already registered for this event.";
		}
		const ticketOptions = $('#booking_tickets > option').get();
		const manualOption = $('#booking_tickets');

		if(ticketOptions.length < 1 && !manualOption){
			throw "No valid options for registration were found for this event.";
		}

		if(ticketOptions.length > 1){
			var option = ticketOptions[ticketOptions.length-1];
			count = parseInt(option.attribs.value);
		}
		count = count || 1
		return makeRequest('POST', 'https://www.houseseven.com/'+type+'/'+id+'/booking', {
			'booking[event_id]': id,
			'booking[tickets]': count,
			authenticity_token: token,
			utf8: '✓'
		})
	})
	.then(function(){
		console.log(("[✓] Registered for event "+type+" "+id+" with "+(count || 1)+" guests").green);
		registered.push(type+'-'+id);
		db.get('events').push({id: id}).write();
	})
	.catch(function(e){
		console.error(("[x] ("+id+" - "+type+") "+e).red);
	})
}

function processEvents(type, html){
	const $ = cheerio.load(html);
	const events = $('[data-event-badge]').get();

	for(event in events){
		var id = $(events[event]).attr('data-event-badge');
		console.log(("[⥁] Attempting to register "+id+" in the "+type+" category...").cyan)

		registerForEvent(type, id);
	}
}

function getNewEvents(type){
	console.log(("[⥁] Checking for new "+type+"...").cyan)
	for(var i=1;i<=pages;i++){
		makeRequest('GET', 'https://houseseven.com/'+type+'?page='+i, {})
		.then(function(html){
			processEvents(type, html);
		})
	}
}

function runRound(){

	var date = new Date();
	var hour = date.getHours();
	var min  = date.getMinutes();    

	if((hour >= 8 && min >= 59) && (hour <= 9 && min <= 1) ||
		(hour >= 11 && min >= 59) && (hour <= 12 && min <= 1) ||
		(hour >= 19 && min >= 59) && (hour <= 20 && min <= 1)){
		getNewEvents('events');
		getNewEvents('gym-sessions');
		getNewEvents('screenings');
	}else{
		console.error(('[x] ('+hour+':'+min+') Application only checks between 8:59-9:01am, 11:59am-12:01pm, and 7:59pm-8:01pm.').red);
	}

	
}

function startLoop(){
	runRound()
	setInterval(function(){
		runRound();
	}, timeout*1000);
}

var readline = require('readline');

var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(prompt){
	return new Promise(function(res,rej){
		rl.question(prompt, function(answer) {
		    return res(answer);
		});
	})
}

ask("What is your HouseSeven username?\n")
.then(function(answer){
	username = answer;
	return ask("What is your HouseSeven password?\n")
})
.then(function(answer){
	password = answer;
	return ask("How many seconds should go by between every check? [Numbers only 1-1000]\n")
})
.then(function(answer){
	if(answer){
		timeout = parseInt(answer);
	}else{
		answer = 600
	}
	return ask("How many pages should be checked? [Numbers only 1-10]\n")
})
.then(function(answer){
	if(answer){
		pages = parseInt(answer);
	}else{
		answer = 2;
	}
	return makeRequest('GET', 'https://identity.houseseven.com/sessions/new', {})
})
.then(function(response){
	var token = getAuthToken(response);
	return makeRequest('POST', 'https://identity.houseseven.com/sessions', {
		'user[email]': username,
		'user[password]': password,
		authenticity_token: token,
		utf8: '✓'
	})
})
.then(function(response){
	if(response.length > 100){
		console.log(("[x] Login failed").red);
		return;
	}
	console.log(("[✓] Logged in as "+username+"").green);
	startLoop();
})