const cheerio = require('cheerio');
const request = require('request').defaults({jar: true});
const Promise = require('bluebird');
const querystring = require('querystring');
const colors = require('colors');

const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('db.json')
const db = low(adapter)

db.defaults({events: []}).write()

require('dotenv').config()

const username = process.env.USERNAME
const password = process.env.PASSWORD
const timeout = parseInt(process.env.TIMEOUT);
const pages = parseInt(process.env.PAGES);

function makeRequest(method, endpoint, data){
	return new Promise(function(res,rej){

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

function registerForEvent(id){
	var check = db.get('events').find({id: id}).value();
	if(check){
		console.log(("[x] Already registered for ["+id+"]").red)
		return;
	}

	var count; 

	makeRequest('GET', 'https://www.houseseven.com/events/'+id+'/booking')
	.then(function(html){
		var token = getAuthToken(html);

		const $ = cheerio.load(html);
		const ticketOptions = $('#booking_tickets > option').get();

		if(ticketOptions.length < 1){
			throw "No valid options for registration were found for this event.";
		}

		var option = ticketOptions[ticketOptions.length-1];
		count = parseInt(option.attribs.value);

		if(!count || count == 0){
			throw "Invalid Ticket Options (You shouldn't see this)";
		}

		return makeRequest('POST', 'https://www.houseseven.com/events/'+id+'/booking', {
			'booking[event_id]': id,
			'booking[tickets]': count,
			authenticity_token: token,
			utf8: '✓'
		})
	})
	.then(function(){
		console.log(("[✓] Registered for event "+id+" with "+count+" guests").green);
		db.get('events').push({id: id}).write();
	})
	.catch(function(e){
		console.error(("[x] ("+id+") "+e).red);
	})
}

function processEvents(html){
	const $ = cheerio.load(html);
	const events = $('[data-event-badge]').get();

	for(event in events){
		var id = $(events[event]).attr('data-event-badge');
		console.log(("[⥁] Attempting to register for event "+id+"...").cyan)
		registerForEvent(id);
	}
}

function getNewEvents(){
	console.log("[⥁] Checking for new events...".cyan)
	for(var i=1;i<=pages;i++){
		makeRequest('GET', 'https://houseseven.com/events?page='+i, {})
		.then(function(html){
			processEvents(html);
		})
	}
}
function startLoop(){
	getNewEvents();
	setInterval(function(){
		getNewEvents();
	}, timeout*1000);
}

makeRequest('GET', 'https://identity.houseseven.com/sessions/new', {})
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
	console.log(("[✓] Logged in as "+username+"").green);
	startLoop();
})