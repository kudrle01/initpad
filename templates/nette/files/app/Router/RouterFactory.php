<?php

namespace App\Router;

use Nette\Application\Routers\RouteList;

final class RouterFactory
{
    public static function createRouter(): RouteList
    {
        $router = new RouteList;
        $router->addRoute('health', 'Home:health');
        $router->addRoute('', 'Home:default');
        return $router;
    }
}
