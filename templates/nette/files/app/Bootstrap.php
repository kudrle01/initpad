<?php

namespace App;

use Nette\Bootstrap\Configurator;

final class Bootstrap
{
    public static function boot(): Configurator
    {
        $configurator = new Configurator;
        $configurator->setTempDirectory(dirname(__DIR__).'/temp');
        $configurator->addConfig(dirname(__DIR__).'/config/common.neon');
        return $configurator;
    }
}
