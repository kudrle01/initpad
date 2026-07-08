<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Annotation\Route;

class AppController extends AbstractController
{
    #[Route('/', name: 'root')]
    public function root(): JsonResponse
    {
        return new JsonResponse(['status' => 'ok']);
    }

    #[Route('/health', name: 'health')]
    public function health(): JsonResponse
    {
        return new JsonResponse(['status' => 'ok']);
    }
}
