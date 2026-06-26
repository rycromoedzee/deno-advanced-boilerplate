#!/bin/bash

echo "🔄 Syncing admin token from Deno .env to Vue.js..."

# Read token from Deno .env
TOKEN=$(grep INTERNAL_TOOL_KEY .env | cut -d '=' -f2)

# Check if token exists
if [ -z "$TOKEN" ]; then
    echo "❌ INTERNAL_TOOL_KEY not found in .env"
    echo "   Make sure your Deno .env file has INTERNAL_TOOL_KEY set"
    exit 1
fi

# Update Vue.js .env.development
cat > admin-ui/.env.development << EOF
VITE_API_BASE_URL=http://localhost:55555
VITE_ADMIN_PATH=/internal/__admin
VITE_ADMIN_TOKEN=$TOKEN
EOF

# Update Vue.js .env.production
cat > admin-ui/.env.production << EOF
VITE_API_BASE_URL=
VITE_ADMIN_PATH=/internal/__admin
VITE_ADMIN_TOKEN=$TOKEN
EOF

echo "✅ Token synced successfully!"
echo "   Token (first 30 chars): ${TOKEN:0:30}..."
echo ""
echo "📝 Next steps:"
echo "   1. cd admin-ui"
echo "   2. pnpm install  (if not already done)"
echo "   3. pnpm dev"
echo ""
echo "🌐 Then access admin UI at:"
echo "   http://localhost:5173/internal/__admin"
echo ""
echo "   Or use URL with token:"
echo "   http://localhost:5173/internal/__admin?admin_token=$TOKEN"