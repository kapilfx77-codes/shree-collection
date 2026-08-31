// Product Database - Synced from shree_collection.db
const products = [
    {
        id: 1,
        name: "Korean Pant",
        price: 1400,
        originalPrice: null,
        colors: ["Standard"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=800&q=80",
            "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=800&q=80"
        ],
        description: "Comfortable Korean-style pant perfect for casual and semi-formal occasions.",
        featured: true,
        in_stock: true
    },
    {
        id: 2,
        name: "Paper Plazo",
        price: 275,
        originalPrice: null,
        colors: ["Standard"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1598522325074-042db73aa4e6?w=800&q=80",
            "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80"
        ],
        description: "Light and breezy paper plazo ideal for summer and everyday comfort.",
        featured: false,
        in_stock: false
    },
    {
        id: 3,
        name: "Cord Set",
        price: 1250,
        originalPrice: 1600,
        colors: ["Standard"],
        sizes: ["Free Size", "Size 4"],
        images: [
            "https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=800&q=80",
            "https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80"
        ],
        description: "Stylish coordinated set perfect for parties and special occasions.",
        featured: true,
        in_stock: true
    },
    {
        id: 4,
        name: "Designer Suit - Cream",
        price: 2100,
        originalPrice: null,
        colors: ["Cream"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80",
            "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80"
        ],
        description: "Elegant cream designer suit with intricate embroidery and premium fabric.",
        featured: true,
        in_stock: true
    },
    {
        id: 18,
        name: "Designer Suit - Mehroon",
        price: 1600,
        originalPrice: null,
        colors: ["Mehroon"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80",
            "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80"
        ],
        description: "Elegant mehroon designer suit with intricate embroidery and premium fabric.",
        featured: false,
        in_stock: false
    },
    {
        id: 19,
        name: "Designer Suit - Pink",
        price: 1600,
        originalPrice: null,
        colors: ["Pink"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80",
            "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80"
        ],
        description: "Elegant pink designer suit with intricate embroidery and premium fabric.",
        featured: false,
        in_stock: false
    },
    {
        id: 20,
        name: "Designer Suit - Rust",
        price: 1600,
        originalPrice: null,
        colors: ["Rust"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80",
            "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80"
        ],
        description: "Elegant rust designer suit with intricate embroidery and premium fabric.",
        featured: false,
        in_stock: false
    },
    {
        id: 21,
        name: "Designer Suit - Reban",
        price: 1500,
        originalPrice: null,
        colors: ["Reban"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80",
            "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80"
        ],
        description: "Elegant reban designer suit with intricate embroidery and premium fabric.",
        featured: false,
        in_stock: true
    },
    {
        id: 5,
        name: "Baran Pant",
        price: 1350,
        originalPrice: null,
        colors: ["Standard"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=800&q=80",
            "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?w=800&q=80"
        ],
        description: "Traditional Baran pant with comfortable fit and elegant design.",
        featured: false,
        in_stock: false
    },
    {
        id: 6,
        name: "Paper Set",
        price: 275,
        originalPrice: null,
        colors: ["Standard"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?w=800&q=80",
            "https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80"
        ],
        description: "Light paper fabric set for everyday comfort.",
        featured: false,
        in_stock: true
    },
    {
        id: 7,
        name: "Designer Tshirt - Patti",
        price: 260,
        originalPrice: null,
        colors: ["Patti"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80",
            "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=800&q=80"
        ],
        description: "Trendy designer t-shirt with beautiful Patti pattern.",
        featured: false,
        in_stock: true
    },
    {
        id: 25,
        name: "Designer Tshirt - Moti",
        price: 270,
        originalPrice: null,
        colors: ["Moti"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80",
            "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=800&q=80"
        ],
        description: "Trendy designer t-shirt with beautiful Moti pattern.",
        featured: false,
        in_stock: false
    },
    {
        id: 26,
        name: "Designer Tshirt - Design",
        price: 1050,
        originalPrice: null,
        colors: ["Design"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80",
            "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=800&q=80"
        ],
        description: "Premium designer t-shirt with intricate design work.",
        featured: false,
        in_stock: true
    },
    {
        id: 8,
        name: "Ethnic Top",
        price: 600,
        originalPrice: 650,
        colors: ["Standard", "G"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=800&q=80",
            "https://images.unsplash.com/photo-1564859228273-274232fdb516?w=800&q=80"
        ],
        description: "Stylish ethnic top perfect for casual and semi-formal wear.",
        featured: false,
        in_stock: true
    },
    {
        id: 9,
        name: "Traditional Kurta - Pink",
        price: 1000,
        originalPrice: null,
        colors: ["Pink"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80",
            "https://images.unsplash.com/photo-1598522325074-042db73aa4e6?w=800&q=80"
        ],
        description: "Beautiful traditional kurta in vibrant pink color.",
        featured: false,
        in_stock: true
    },
    {
        id: 22,
        name: "Traditional Kurta - Light Pink",
        price: 650,
        originalPrice: null,
        colors: ["Light Pink"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80",
            "https://images.unsplash.com/photo-1598522325074-042db73aa4e6?w=800&q=80"
        ],
        description: "Beautiful traditional kurta in soft light pink color.",
        featured: true,
        in_stock: true
    },
    {
        id: 23,
        name: "Traditional Kurta - Dull",
        price: 1950,
        originalPrice: null,
        colors: ["Dull"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80",
            "https://images.unsplash.com/photo-1598522325074-042db73aa4e6?w=800&q=80"
        ],
        description: "Beautiful traditional kurta in elegant dull shade.",
        featured: false,
        in_stock: true
    },
    {
        id: 24,
        name: "Traditional Kurta - Red",
        price: 1850,
        originalPrice: null,
        colors: ["Red"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1585168339311-842b17c516cd?w=800&q=80",
            "https://images.unsplash.com/photo-1598522325074-042db73aa4e6?w=800&q=80"
        ],
        description: "Beautiful traditional kurta in bold red color.",
        featured: false,
        in_stock: true
    },
    {
        id: 10,
        name: "Festive Set",
        price: 1500,
        originalPrice: 1950,
        colors: ["Standard", "K"],
        sizes: ["Free Size", "Size 1"],
        images: [
            "https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=800&q=80",
            "https://images.unsplash.com/photo-1595777216742-96069a2c7782?w=800&q=80"
        ],
        description: "Complete festive set perfect for celebrations and special occasions.",
        featured: true,
        in_stock: true
    },
    {
        id: 11,
        name: "Kaju Design Set",
        price: 1200,
        originalPrice: null,
        colors: ["Reban"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1614016643991-af6c76573bc4?w=800&q=80",
            "https://images.unsplash.com/photo-1610652490822-65b70dfc4306?w=800&q=80"
        ],
        description: "Elegant Kaju design set with intricate embroidery work.",
        featured: false,
        in_stock: true
    },
    {
        id: 12,
        name: "Silk Saree",
        price: 2000,
        originalPrice: null,
        colors: ["Silk"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80",
            "https://images.unsplash.com/photo-1606800052052-a1d82d29d28c?w=800&q=80"
        ],
        description: "Premium silk saree with elegant drape and luxurious feel. Perfect for weddings and grand celebrations.",
        featured: true,
        in_stock: true
    },
    {
        id: 13,
        name: "Banmansika Saree",
        price: 1550,
        originalPrice: null,
        colors: ["Banmansika"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1617627925922-1e951cd4200d?w=800&q=80",
            "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80"
        ],
        description: "Beautiful Banmansika saree with traditional patterns and vibrant colors.",
        featured: true,
        in_stock: true
    },
    {
        id: 14,
        name: "Alexa Georgette Saree",
        price: 700,
        originalPrice: null,
        colors: ["Alexa"],
        sizes: ["Georgette"],
        images: [
            "https://images.unsplash.com/photo-1606800052052-a1d82d29d28c?w=800&q=80",
            "https://images.unsplash.com/photo-1617627925922-1e951cd4200d?w=800&q=80"
        ],
        description: "Light and flowy Alexa georgette saree perfect for casual and semi-formal occasions.",
        featured: false,
        in_stock: true
    },
    {
        id: 15,
        name: "Khaddi Saree",
        price: 1650,
        originalPrice: null,
        colors: ["Khaddi"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80",
            "https://images.unsplash.com/photo-1606800052052-a1d82d29d28c?w=800&q=80"
        ],
        description: "Traditional Khaddi saree with rich texture and elegant design.",
        featured: false,
        in_stock: true
    },
    {
        id: 16,
        name: "Babli Saree",
        price: 2400,
        originalPrice: null,
        colors: ["Babli"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1617627925922-1e951cd4200d?w=800&q=80",
            "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80"
        ],
        description: "Premium Babli saree with intricate work and stunning appeal.",
        featured: true,
        in_stock: true
    },
    {
        id: 17,
        name: "Sapan Saree",
        price: 800,
        originalPrice: null,
        colors: ["Sapan"],
        sizes: ["Free Size"],
        images: [
            "https://images.unsplash.com/photo-1606800052052-a1d82d29d28c?w=800&q=80",
            "https://images.unsplash.com/photo-1617627925922-1e951cd4200d?w=800&q=80"
        ],
        description: "Elegant Sapan saree with beautiful color combinations and comfortable fabric.",
        featured: false,
        in_stock: true
    }
];

// Storage functions
const STORAGE_KEY = 'shree_collection_products';

function saveProducts() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

function loadProducts() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        return JSON.parse(stored);
    }
    return products;
}

function getProducts() {
    return loadProducts();
}

function getProductById(id) {
    return getProducts().find(p => p.id === parseInt(id));
}

function getFeaturedProducts() {
    return getProducts().filter(p => p.featured);
}

function searchProducts(query) {
    const q = query.toLowerCase();
    return getProducts().filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.colors.some(c => c.toLowerCase().includes(q))
    );
}

function filterProducts(filters) {
    let filtered = getProducts();

    if (filters.minPrice) {
        filtered = filtered.filter(p => p.price >= filters.minPrice);
    }

    if (filters.maxPrice) {
        filtered = filtered.filter(p => p.price <= filters.maxPrice);
    }

    if (filters.color) {
        filtered = filtered.filter(p => p.colors.includes(filters.color));
    }

    if (filters.size) {
        filtered = filtered.filter(p => p.sizes.includes(filters.size));
    }

    return filtered;
}

// Initialize storage on first load
if (!localStorage.getItem(STORAGE_KEY)) {
    saveProducts();
}
