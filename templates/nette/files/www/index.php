<?php

use App\Bootstrap;
use Nette\Application\Application;

require dirname(__DIR__).'/vendor/autoload.php';

try {
    Bootstrap::boot()->createContainer()->getByType(Application::class)->run();
} catch (Throwable $error) {
    error_log((string) $error);
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['status' => 'error'], JSON_THROW_ON_ERROR);
}
