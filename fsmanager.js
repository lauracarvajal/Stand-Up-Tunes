var debug = require('debug')('fsmanager');
var fs = require('fs');
var domain = require('domain').create();

var ONE_KB = 1024;
var HUNDRED_KB = ONE_KB * 100;
var ONE_MB = Math.pow(ONE_KB, 2);
var FIVE_MB = ONE_MB * 5;

/**
 * Read the tunes folder and load all available file names
 * Read the backup.json file for any previously backed up vote counts
 */
exports.init = function () {
    debug('init');

    fs.readdir('public/tunes', function (err, files) {

        if (err) {
            debug('error reading public tunes folder', err);
            throw err;
        }

        // Load the file names into the global files object
        // Filter out anything that's not an audio file
        for (var i = 0; i < files.length; i++) {

            var file = files[i];

            if (file.indexOf('.mp3') > 0 || file.indexOf('.wav') > 0) {
                GLOBAL.files[file] = {
                    votes: 0
                };
            }
        }

        // Try to read the votes file synchronously
        // (we don't want clients connecting until we've fully loaded this)
        try {

            // read the contents of the file as a string
            var backupJSON = fs.readFileSync('backup.json', {
                encoding: 'utf8'
            });

            // parse it into an object
            var backup = JSON.parse(backupJSON);

            // read it and
            // load the vote count into memory
            for (var tune in backup) {
                GLOBAL.files[tune].votes = backup[tune].votes;
            }
        }
        catch (error) {
            // no backup file yet
            // create one
            fs.writeFileSync('backup.json', '');
        }

    });
};

/**
 * Save the current vote count to disk
 */
exports.save = function () {
    domain.run(function () {
        fs.writeFile('backup.json', JSON.stringify(GLOBAL.files), function () {
            debug('Vote count saved!');
        });
    });
};

domain.on('error', function (e) {
    debug('error in fsmanager', e);
});

/**
 * Write a 100KB chunk of a file to disk
 * Notify the client when done
 * so it can send the next chunk
 * @param {Object} data
 * @param {Socket} socket
 */
exports.upload = function (data, socket) {
    var name = data.name;
    var thisFile = GLOBAL.files[name];

    thisFile.downloaded += data.data.length;
    thisFile.data += data.data;

    // If this is the last chunk of the file
    if (thisFile.downloaded === thisFile.fileSize) {

        fs.write(thisFile.handler, thisFile.data, null, 'Binary', function () {
            socket.emit('done', name);
            socket.broadcast.emit('done', name);
            debug('done!');
        });
    }
    else if (thisFile.data.length > FIVE_MB) {

        // TODO emit it
        debug('File too big');
    }
    else {

        var size = thisFile.fileSize;
        var marker = thisFile.downloaded / HUNDRED_KB;
        var percent = (thisFile.downloaded / GLOBAL.files[name].fileSize) * 100;

        debug('progress ' + Math.round(percent) + '%');

        // Ask for more data
        socket.emit('more data', {
            marker: marker,
            percent: percent,
            size: size
        });
    }
};

/**
 * Init a file upload
 * @param  {Object} data
 * @param  {Socket} socket
 */
exports.startUpload = function (data, socket) {
    var name = safeifyString(data.name);

    // Add the file to the global file list
    GLOBAL.files[name] = {
        fileSize: data.size,
        handler: '',
        data: '',
        downloaded: 0,
        votes: 0
    };

    var marker = 0;

    try {
        var existingFile = fs.statSync('public/tunes/' + name);

        // If the file exists in public/tunes/
        // continue downloading where we left off
        if (existingFile.isFile()) {
            debug('Resuming upload...');
            GLOBAL.files[name].downloaded = existingFile.size;
            marker = existingFile.size / HUNDRED_KB;
        }
    }
    catch (err) {
        debug('Uploading new tune...');
    }

    /**
     * If it's a new file we create it,
     * if it's an existing file we open it.
     * We ask the client to send more data.
     */
    fs.open('public/tunes/' + name, 'a', 0755, function (err, fd) {
        if (err) {
            debug(err);
        }
        else {
            // Store the file handler so we can write to it later
            GLOBAL.files[name].handler = fd;

            socket.emit('more data', {
                marker: marker,
                percent: 0
            });
        }
    });
};

/**
 * Remove unsafe characters from a string
 * afplay can't handle spaces
 * TODO remove other characters as needed
 */
var safeifyString = function (unsafeString) {
    return unsafeString.replace(' ', '');
};
