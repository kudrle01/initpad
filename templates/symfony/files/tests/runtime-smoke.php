<?php

declare(strict_types=1);

$body = @file_get_contents('http://127.0.0.1:8080/');
$payload = json_decode($body ?: '', true);

exit(($payload['status'] ?? null) === 'ok' ? 0 : 1);
