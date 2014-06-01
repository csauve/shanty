function MainCtrl($scope) {
    $scope.connected = false;
    var socket = io.connect();

    socket.on("connect", function() {
        $scope.$apply(function() {
            $scope.connected = true;
            socket.emit("ready", $.cookie("sessionId"));
        });
    });

    socket.on("disconnect", function() {
        $scope.$apply(function() { $scope.connected = false; });
    });

    socket.on("welcome", function(data) {
        $.cookie("sessionId", data.sessionId, {expires: 7});
        $scope.$apply(function() { $scope.downloads = data.downloads || []; });
    });

    $scope.queueDownload = function() {
        if ($scope.formUrl) {
            socket.emit("queue-download", $scope.formUrl);
            $scope.formUrl = "";
        }
    };

    var timeout;
    $scope.metadataChanged = function(download) {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(function() {
            socket.emit("apply-metadata", download);
        }, 400);
    };

    socket.on("download-updated", function(download) {
        $scope.$apply(function() {
            for (var i = 0; i < $scope.downloads.length; i++) {
                if ($scope.downloads[i]._id == download._id) {
                    //update properties rather than replacing object to keep inputs in focus
                    for (key in download) {
                        var value = download[key];
                        $scope.downloads[i][key] = value;
                    }
                    return;
                }
            }
            $scope.downloads.push(download);
        });
    });
}