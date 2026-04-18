const particlesConfig = {
    particles: {
        number: { 
            value: 100, 
            density: { enable: true, value_area: 800 } 
        },
        color: { value: ["#e56b4f", "#4a90e2", "#f0d78c"] }, // Branded colors for more activity
        shape: { type: "circle" },
        opacity: { 
            value: 0.6, 
            random: true,
            anim: { enable: true, speed: 1, opacity_min: 0.1, sync: false }
        },
        size: { 
            value: 4, 
            random: true,
            anim: { enable: true, speed: 2, size_min: 0.1, sync: false }
        },
        line_linked: {
            enable: true,
            distance: 150,
            color: "#4a90e2",
            opacity: 0.4,
            width: 1.5,
            shadow: {
                enable: true,
                color: "#4a90e2",
                blur: 5
            }
        },
        move: {
            enable: true,
            speed: 3.5, // Faster movement
            direction: "none",
            random: true,
            straight: false,
            out_mode: "out",
            bounce: false,
            attract: { enable: true, rotateX: 600, rotateY: 1200 }
        }
    },
    interactivity: {
        detect_on: "canvas",
        events: {
            onhover: { enable: true, mode: "bubble" },
            onclick: { enable: true, mode: "push" },
            resize: true
        },
        modes: {
            grab: { distance: 200, line_linked: { opacity: 1 } },
            bubble: { distance: 200, size: 8, duration: 2, opacity: 0.8, speed: 3 },
            push: { particles_nb: 4 }
        }
    },
    retina_detect: true
};

function initParticles() {
    if (window.tsParticles) {
        tsParticles.load("tsparticles", particlesConfig)
            .then(() => console.log("Particles loaded successfully"))
            .catch(error => console.error("Particles failed to load", error));
    } else {
        console.error("tsParticles library not found");
    }
}

// Use window.onload to ensure the library is loaded from CDN
window.onload = initParticles;
