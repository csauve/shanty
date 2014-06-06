var config = require("config");
var events = require("events");
var util = require("util");
var Datastore = require("nedb");
var path = require("path");
var fs = require("fs");
var ytdl = require("ytdl");
var mkdirp = require("mkdirp");
var FFmpeg = require("fluent-ffmpeg");
var taglib = require("taglib");
var SoundRain = require("soundrain");
var moment = require("moment");
var sanitize = require("sanitize-filename");

var downloads = new Datastore({
    filename: path.join(config.downloadsDir, "downloads.db"),
    autoload: true
});

function getPath(download, extension) {
    return path.join(config.downloadsDir, download._id + "." + extension);
}

function suggestFilename(download) {
    if (!download.metadata) return sanitize(download._id + ".mp3");
    var artist = download.metadata.artist, title = download.metadata.title;
    if (artist && artist.trim() && title && title.trim())
        return sanitize(artist.trim() + " - " + title.trim() + ".mp3");
    return sanitize((download.title || "download") + ".mp3");
}

function DownloaderService() {
    events.EventEmitter.call(this);
    var self = this;

    function emitUpdated(download, status, callback) {
        download.status = status;
        self.emit("download-updated", download);
        if (callback) downloads.update({_id: download._id}, download, {}, function(err, numReplaced) {
            callback(err);
        });
    }

    function emitFailure(download, error) {
        if (error) console.error(error);
        clearDownloadFiles(download);
        downloads.remove({_id: download._id}, {}, function(err, numRemoved) {
            if (err) console.error(err);
            download.status = "Failed";
            self.emit("download-updated", download);
        });
    }

    function clearDownloadFiles(download) {
        var mp3Path = getPath(download, "mp3");
        var flvPath = getPath(download, "flv");
        fs.exists(mp3Path, function(exists) {
            if (exists) fs.unlink(mp3Path, function(error) {
                if (error) console.error("Failed to remove " + mp3Path);
            });
        });
        fs.exists(flvPath, function(exists) {
            if (exists) fs.unlink(flvPath, function(error) {
                if (error) console.error("Failed to remove " + flvPath);
            });
        });
    }

    function expireDownload(download) {
        downloads.remove({_id: download._id}, {}, function(error, numRemoved) {
            if (error) console.error("Failed to expire " + download._id + " from datastore");
            else emitUpdated(download, "Expired");
        });
        clearDownloadFiles(download);
    }

    (function hourly() {
        var cutoff = moment().subtract("hours", config.maxStorageTimeHours);
        downloads.find({dateQueued: {$lt: cutoff}, status: "Ready"}, function(error, downloads) {
            if (error) return console.error(error);
            if (downloads.length > 0) console.log("Expiring " + downloads.length + " downloads");
            downloads.forEach(function(download) {
                expireDownload(download);
            });
        });
        setTimeout(hourly, 60 * 60 * 1000);
    })();

    function downloadMedia(download) {
        mkdirp(config.downloadsDir, function(error) {
            if (error) return emitFailure(download, error);
            emitUpdated(download, "Downloading");
            var urlClean = download.url.toLowerCase().trim();
            if (urlClean.indexOf("youtube.com") != -1) downloadFromYoutube(download);
            else if (urlClean.indexOf("soundcloud.com") != -1) downloadFromSoundcloud(download);
            else emitFailure(download, "Unsupported media source: " + download.url);
        });
    }

    function downloadFromSoundcloud(download) {
        console.log("Downloading from soundcloud: " + download.url);
        var song = new SoundRain(download.url, config.downloadsDir);
        song.on("error", function(err) {
            emitFailure(download, err);
        }).on("done", function(file) {

            //todo: get title and guess metadata, art

            download.metadata = {};

            fs.renameSync(file, getPath(download, "mp3"));
            emitUpdated(download, "Untagged", function(error) {
                if (error) return emitFailure(download, error);
                applyMetadata(download);
            });
        });
    }

    function downloadFromYoutube(download) {
        console.log("Downloading from youtube: " + download.url);
        ytdl.getInfo(download.url, function(error, info) {
            if (error) return emitFailure(download, error);

            download.title = info.title;
            var match = info.title.match(new RegExp("(.+)\\s+-\\s+(.+(?: \\(.+\\))?)", "i"));
            download.metadata = match ? {
                artist: match[1],
                title: match[2]
            } : {};
            
            //todo: guess art

            var flvPath = getPath(download, "flv");
            var flvFile = fs.createWriteStream(flvPath);
            ytdl(download.url).pipe(flvFile);

            flvFile.on("close", function() {
                emitUpdated(download, "Downloaded", function(error) {
                    if (error) return emitFailure(download, error);
                    convertMedia(download, flvPath);
                });
            });
        });
    }

    function convertMedia(download, flvPath) {
        console.log("Converting FLV to MP3: " + flvPath);
        emitUpdated(download, "Converting");
        var dstPath = getPath(download, "mp3");

        new FFmpeg({source: flvPath, nolog: true})
        .withAudioCodec("libmp3lame")
        .toFormat("mp3")
        .saveToFile(dstPath, function(retcode, stderr) {
            //retcode and stderr useless?
            fs.unlinkSync(flvPath);
            emitUpdated(download, "Untagged", function(error) {
                if (error) return emitFailure(download, error);
                applyMetadata(download);
            });
        });
    }

    //todo: clear any existing tags
    //todo: download and apply art
    function applyMetadata(applyDownload) {
        downloads.findOne({_id: applyDownload._id}, function(err, download) {
            if (err) return emitFailure(download, error);
            if (!download) return emitFailure(download, "Download does not exist");

            var newMetadata = applyDownload.metadata;
            var mp3Path = getPath(download, "mp3");
            console.log("Applying metadata to " + mp3Path);
            //emitUpdated(download, "Applying Metadata");

            var tag = taglib.tagSync(mp3Path);
            for (key in newMetadata) {
                key = key.toLowerCase();
                var value = newMetadata[key];
                if (value) tag[key] = value.trim();
            }
            tag.saveSync();

            download.metadata = newMetadata;
            download.filename = suggestFilename(download);
            emitUpdated(download, "Ready", function(error) {
                if (error) return emitFailure(download, error);
            });
        });
    }

    self.applyMetadata = applyMetadata;

    self.resumeDownloads = function() {
        downloads.find({status: {$ne: "Ready"}}, function(err, downloads) {
            if (err) return console.error("Failed to resume downloads");
            downloads.forEach(function(download) {
                if (download.status == "Queued") downloadMedia(download);
                else if (download.status == "Downloaded") convertMedia(download);
                else if (download.status == "Untagged") applyMetadata(download);
            });
        });
    };

    self.getDownloads = function(sessionId, callback) {
        downloads.find({sessionId: sessionId}).sort({dateQueued: -1}).exec(callback);
    };

    self.enqueue = function(sessionId, url, callback) {
        downloads.insert({
            sessionId: sessionId,
            status: "Queued",
            url: url,
            dateQueued: new Date()
        }, function(error, download) {
            if (!error) downloadMedia(download);
            callback(error, download);
        });
    };

    self.getMp3 = function(downloadId, callback) {
        downloads.findOne({_id: downloadId}, function(error, download) {
            if (error) return callback(error);
            if (download.status != "Ready") return callback("Download " + download._id + " is not ready to get")
            callback(error, download, download ? getPath(download, "mp3") : undefined);
        });
    };
};

util.inherits(DownloaderService, events.EventEmitter);
var service = new DownloaderService();
service.setMaxListeners(0);
module.exports = service;