// Copyright 2017,2018 Axiomware Systems Inc. 
//
// Licensed under the MIT license <LICENSE-MIT or 
// http://opensource.org/licenses/MIT>. This file may not be copied, 
// modified, or distributed except according to those terms.
//


//Add external modules dependencies
var netrunr = require('netrunr-gapi');
var inquirer = require('inquirer');
var chalk = require('chalk');
var figlet = require('figlet');


//Gobal variables
var gapi = new netrunr.gapi();//Create an instance  Netrunr gateway object
var exitFlag = false;                                   //set flag when exiting
var gConnStatus = 0; //1-> if connected to gateway 0-> otherwise

//User configuration
var userConfig = {           
    'scanPeriod': 1,    // seconds of advertising scan
    'scanMode': 1,      // 1-> active, 0-> passive
};

//Used to monitor for ctrl-c and exit program
process.on("SIGINT", function () {
    axShutdown("Received Ctrl-C - shutting down.. please wait");
});

//Application start - startup banner
console.log(chalk.green.bold(figlet.textSync('NETRUNR GATEWAY', { horizontalLayout: 'default' })));
console.log(chalk.green.bold('Advertisement Scanner Application'));
console.log(chalk.green('Scan period = ' + userConfig.scanPeriod + ' Sec, Scan mode = ' + (userConfig.scanMode ? 'Active' : 'Passive')));
console.log(chalk.red.bold('Press Ctrl-C to exit'));
axmUIgetAxiomwareCredentials(); // Call main function

/**
 * Main program entry point
 * Using Command Line Interface (CLI), get user credentails and excute axLogin function
 * 
 */
function axmUIgetAxiomwareCredentials() {
    var questions = [
        {
            name: 'user',
            type: 'input',
            message: 'Enter your Axiomware account username(e-mail):',
            validate: (email) => { return validateEmail(email) ? true : 'Please enter valid e-mail address'; }
        },
        {
            name: 'pwd',
            type: 'password',
            message: 'Enter your password:',
            validate: (pwd) => { return (pwd.length > 0) ? true : 'Please enter your password'; }
        }
    ];
    inquirer.prompt(questions).then(function (answer) {
        axLogin(answer.user, answer.pwd); // call login function
    });
}

/**
 * Login to your account and select the first gateway listed in your account
 * 
 * @param {string} user - username
 * @param {string} pwd - password
 */
function axLogin(user , pwd) {
    gapi.login({ 'user': user, 'pwd': pwd },
        function (robj) {
            console.log('Login success [user:' + user + ']');
            if (robj.gwid.length > 0) {
                console.log('Found ' + robj.gwid.length + ' Gateways');
                robj.gwid.forEach(function (gw) { console.log(gw) }); // print gateway list
                axOpenConnection(robj.gwid[0]);//open connection to first gateway in the list
            }
            else {// no gateways fount. Exit
                axShutdown('Found no gateways - exiting (nothing to do)');
            }
        },
        function (robj) {
            axShutdown('Login error - exiting');
        });
}

/**
 * Open connection to the selected gateway
 * 
 * @param {string} gwid - gateway ID of the selected gateway
 */
function axOpenConnection(gwid) {
    gapi.config({ 'gwid': gwid }); //select gateway

    gapi.open({},
        function (robj) {
            gConnStatus = 1; //Set connected status ON
            console.log('Connection open success');
            gapi.event({ 'did': '*' }, myGatewayEventHandler, null);     //Attach event handlers
            gapi.report({ 'did': '*' }, myGatewayReportHandler, null);  //Attach report handlers
            axGetVersionInfo(gwid);                                     //Get version information
        },
        function (robj) {
            axShutdown('Failed to open connection - exiting');
        }
    );
}

/**
 * Get version information from the Netrunr gateway
 * 
 *  @param {string} gwid - gateway ID
 */
function axGetVersionInfo(gwid) {
    console.log('Fetching version info of [gwid:' + gwid + ']');
    gapi.version({},//get gateway version
        function (robj) {
            console.log('Netrunr gateway [' + gwid + '] version = ' + robj.version);
            axScanForBLEdev();                                          //Scan for advertisements
        },
        function (robj) {
            axShutdown('Failed to open connection - exiting');
        }
    );
};

/**
 * Scan for BLE devices and generate "scan complete" event at the end of scan
 * 
 */
function axScanForBLEdev() {
    if(!exitFlag) {
    gapi.list({ 'active': userConfig.scanMode, 'period': userConfig.scanPeriod },
        function (robj) {
            //console.log('List started' + JSON.stringify(robj, null, 0) + '\nType CTRL-C to exit');
        },
        function (robj) {
            axShutdown('List failed' + JSON.stringify(robj, null, 0));
        });
    }
}

/**
 * Event handler (for scan complete, disconnection, etc events)
 * 
 * @param {Object} iobj - Event handler object - see API docs
 */
function myGatewayEventHandler(iobj) {
    switch (iobj.event) {
        case 1: //disconnect event
            console.log('Device disconnect event' + JSON.stringify(iobj, null, 0));
            break;
        case 39://Scan complete event
            axScanForBLEdev();//start new scan
            break;
        default:
            console.log('Other unhandled event [' + iobj.event + ']');
    }
}

/**
 * Report handler (for advertisement data, notification and indication events)
 * 
 * @param {Object} iobj - Report handler object - see API docs 
 */
function myGatewayReportHandler(iobj) {
    switch (iobj.report) {
        case 1://adv report
            var advPrnArray = axParseAdv(iobj.nodes);
            axPrintAdvArray(advPrnArray)
            break;
        case 27://Notification report
            console.log('Notification received: ' + JSON.stringify(iobj, null, 0))
            break;
        default:
            console.log('(Other report) ' + JSON.stringify(iobj, null, 0))
    }
}
 
/**
 * Call this function to gracefully shutdown all connections
 * 
 * @param {string} prnStr - String to print before exit
 */
function axShutdown(prnStr) {
    console.log(prnStr);
    exitFlag = true;
    if (gConnStatus) {
        gapi.list({ 'active': userConfig.scanMode, 'period': 0 }, axLogout, axLogout); // stop scanning
    }
    else
        axLogout();
};

/**
 * Logout function
 * 
 */
function axLogout() {
    gapi.close({}, gapi.logout({}, axExit, axExit), gapi.logout({}, axExit, axExit));//close and logout
}

//Exit
/**
 * Exit function
 * 
 */
function axExit() {
    process.exit();//exit the process
}

// Utitlity Functions

/**
 * Format adv packets to print using console.log
 * 
 * @param {Object[]} advArray - Array of advertsisement objects from report callback
 */
function axPrintAdvArray(advArray) {
    for (var i = 0; i < advArray.length; i++) {
        console.log(JSON.stringify(advArray[i], null, 0));
    }
}

/**
 * Parse advertisement packets
 * 
 * @param {Object[]} advArray - Array of advertsisement objects from report callback
 * @returns 
 */
function axParseAdv(advArray) {
    var advArrayMap = advArray.map(axAdvExtractData);//Extract data
    var advArrayFilter = advArrayMap.filter(axAdvMatchAll);//Filter adv
    return advArrayFilter;
}

/**
 * Function to extract advertisement data
 * 
 * @param {Object} advItem - Single advertisement object
 * @returns {Object} advObj - Single parsed advertisement data object
 */
function axAdvExtractData(advItem) {
    advObj = {
        ts: dateTime(advItem.tss + 1e-6 * advItem.tsus),    //Time stamp
        did: addrDisplaySwapEndianness(advItem.did),        //BLE address
        dt: advItem.dtype,                                  // Adress type
        ev: advItem.ev,                                     //adv packet type
        rssi: advItem.rssi,                                 //adv packet RSSI in dBm
        name: axParseAdvGetName(advItem.adv, advItem.rsp),  //BLE device name
        //adv1: advItem.adv,       //payload of adv packet - uncomment to print on screen
        //rsp1: advItem.rsp,       //payload of rsp packet - uncomment to print on screen
    };
    return advObj;
}

/**
 * Function to match all devices(dummy)
 * 
 * @param {any} advItem 
 * @returns {boolean} - true if advertsiment has to be retained
 */
function axAdvMatchAll(advItem) {
    return (true);
}


/**
 * Function to match TI sensorTag, see http://processors.wiki.ti.com/index.php/CC2650_SensorTag_User%27s_Guide
 * 
 * @param {any} advItem 
 * @returns {boolean} - true if advertsiment has to be retained
 */
function axAdvMatchSensorTag(advItem) {
    return (advItem.name == "CC2650 SensorTag");
}


/**
 * Get device name from advertisement packet
 * 
 * @param {Object} adv - Advertisement payload
 * @param {Object} rsp - Scan response payload
 * @returns {string} - Name of the device or null if not present
 */
function axParseAdvGetName(adv, rsp) {
    var didName = '';
    for (var i = 0; i < adv.length; i++) {
        if ((adv[i].t == 8) || (adv[i].t == 9)) {
            didName = adv[i].v;
            return didName;
        }
    }
    for (var i = 0; i < rsp.length; i++) {
        if ((rsp[i].t == 8) || (rsp[i].t == 9)) {
            didName = rsp[i].v;
            return didName;
        }
    }
    return didName;
}

/**
 * Convert unix seconds to time string - local time (yyyy-mm-ddThh:mm:ss.sss).
 * 
 * @param {Number} s - Number is Unix time format
 * @returns {string} - in local time format
 */
function dateTime(s) {
    var d = new Date(s*1000);
    var localISOTime = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, -1);
    return localISOTime;
}

/**
 * Validate email
 * 
 * @param {string} email - string in valid email format
 * @returns boolean - true if valid email address based on RegEx match
 */
function validateEmail(email) {
    var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
}

/**
 * Swap endianness of a hex-string 
 * 
 * @param {string} hexStr - Hex string(make sure length is even)
 * @returns {string} 
 */
function swapEndianness(hexStr) {
    if (hexStr.length > 2)
        return hexStr.replace(/^(.(..)*)$/, "0$1").match(/../g).reverse().join("");
    else
        return hexStr
}

/**
 * Swap endianness of a hex-string. Format it to standard BLE address style
 * 
 * @param {string} hexStr - Hex string(make sure length is even) 
 * @returns {string}
 */
function addrDisplaySwapEndianness(hexStr) {
    if (hexStr.length > 2)
        return hexStr.replace(/^(.(..)*)$/, "0$1").match(/../g).reverse().join(":").toUpperCase();
    else
        return hexStr
}


