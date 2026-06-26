import { createRouter, createWebHistory } from "vue-router";
import { useAuth } from "@/composables/useAuth";

const routes = [
  {
    path: "/internal/__admin",
    component: () => import("@/components/layout/AdminLayout.vue"),
    meta: { requiresAuth: true },
    children: [
      {
        path: "",
        redirect: "/internal/__admin/cache",
      },
      {
        path: "cache",
        name: "CacheVisualizer",
        component: () => import("@/views/CacheVisualizer.vue"),
        meta: { title: "Cache Visualizer" },
      },
      {
        path: "tracing",
        name: "TracingVisualizer",
        component: () => import("@/views/TracingVisualizer.vue"),
        meta: { title: "Tracing" },
      },
      {
        path: "threat-intel",
        name: "ThreatIntelligence",
        component: () => import("@/views/ThreatIntelligence.vue"),
        meta: { title: "Threat Intelligence" },
      },
    ],
  },
  {
    path: "/internal/__admin/404",
    name: "NotFound",
    component: () => import("@/views/NotFound.vue"),
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/internal/__admin/404",
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Navigation guard for authentication
router.beforeEach((to, _from, next) => {
  const { isAuthenticated } = useAuth();
  console.log("[Router Guard] Navigation to:", to.path);
  console.log("[Router Guard] requiresAuth:", to.meta.requiresAuth);
  console.log("[Router Guard] isAuthenticated:", isAuthenticated.value);

  if (to.meta.requiresAuth && !isAuthenticated.value) {
    console.log("[Router Guard] Authentication failed, redirecting to 404");
    next("/internal/__admin/404");
  } else {
    console.log("[Router Guard] Authentication passed, continuing");
    next();
  }
});

export default router;
