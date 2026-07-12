<?php

use App\Bootstrap;
use Nette\Application\Application;

require dirname(__DIR__).'/vendor/autoload.php';

Bootstrap::boot()->createContainer()->getByType(Application::class)->run();
