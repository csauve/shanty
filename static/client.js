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
        $scope.$apply(function() {
            $scope.connected = false;
        });
    });

    socket.on("welcome", function(data) {
        $.cookie("sessionId", data.sessionId, {expires: 7});
        $scope.$apply(function() {
            $scope.downloads = data.downloads || [];
        });
    });

    $scope.startDownload = function() {
        if ($scope.formUrl) {
            socket.emit("queue-download", $scope.formUrl);
            $scope.formUrl = "";
        }
    };

    socket.on("download-updated", function(download) {
        $scope.$apply(function() {
            for (var i = 0; i < $scope.downloads.length; i++) {
                if ($scope.downloads[i]._id == download._id) {
                    $scope.downloads[i] = download;
                    return;
                }
            }
            $scope.downloads.push(download);
        });
    });

    socket.on("error", function(error) {
        $scope.$apply(function() {
            $scope.error = error.message;
        });
    });

}