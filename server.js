var config = require("config");
var Datastore = require("nedb");
var express = require("express");
var io = require("socket.io");
var downloaderService = require("./downloaderService");

var app = express();
app.use(express.static("static"));
var server = require("http").Server(app);
var socket = io(server);

server.listen(config.port, function() {
    console.log("Listening on port " + config.port);
});

socket.on("connection", function(client) {
    client.on("ready", function(cookieSessionId) {
        client.sessionId = cookieSessionId || client.id;

        downloaderService.getDownloads(client.sessionId, function(error, downloads) {
            if (error) return console.error(error);
            client.emit("welcome", {downloads: downloads, sessionId: client.sessionId});
            
            downloaderService.on("download-updated", function(download) {
                if (download.sessionId == client.sessionId) {
                    client.emit("download-updated", download);
                }
            });
        });
    });

    client.on("queue-download", function(url) {
        downloaderService.enqueue(client.sessionId, url, function(error, download) {
            if (error) return console.error(error);
            client.emit("download-updated", download);
        });
    });
});

downloaderService.resumeDownloads();