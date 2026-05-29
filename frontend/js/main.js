// ===== CLIENTE MANAGER COM LOCALSTORAGE =====
class ClienteManager {
    constructor() {
        this.clientes = this.carregarClientes();
    }

    carregarClientes() {
        const clientesSalvos = localStorage.getItem('oticamacae_clientes');
        return clientesSalvos ? JSON.parse(clientesSalvos) : [];
    }

    salvarClientes() {
        localStorage.setItem('oticamacae_clientes', JSON.stringify(this.clientes));
    }

    cadastrar(cliente) {
        if (this.clientes.some(c => c.email === cliente.email)) {
            return { sucesso: false, mensagem: 'E-mail já cadastrado!' };
        }
        
        cliente.id = Date.now();
        cliente.dataCadastro = new Date().toLocaleDateString('pt-BR');
        this.clientes.push(cliente);
        this.salvarClientes();
        return { sucesso: true, mensagem: '✅ Cadastro realizado com sucesso! Você ganhou 10% OFF na primeira compra.' };
    }
}

const clienteManager = new ClienteManager();

// ===== FORMULÁRIO DE CADASTRO =====
function initCadastroForm() {
    const form = document.getElementById('cadastroForm');
    if (!form) return;

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const cliente = {
            nome: document.getElementById('nome')?.value,
            email: document.getElementById('email')?.value,
            telefone: document.getElementById('telefone')?.value,
            dataNascimento: document.getElementById('dataNascimento')?.value,
            preferencias: document.getElementById('preferencias')?.value,
            aceitaNewsletter: document.getElementById('newsletter')?.checked || false
        };
        
        const resultado = clienteManager.cadastrar(cliente);
        
        const mensagemDiv = document.getElementById('mensagemCadastro');
        mensagemDiv.className = resultado.sucesso ? 'success-message' : 'error-message';
        mensagemDiv.textContent = resultado.mensagem;
        
        if (resultado.sucesso) {
            form.reset();
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 2000);
        } else {
            setTimeout(() => {
                mensagemDiv.style.display = 'none';
            }, 3000);
        }
    });
}

// ===== FORMULÁRIO DE CONTATO =====
function initContatoForm() {
    const form = document.getElementById('contactForm');
    if (!form) return;

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const nome = document.getElementById('contatoNome')?.value;
        const email = document.getElementById('contatoEmail')?.value;
        const mensagem = document.getElementById('contatoMensagem')?.value;
        
        if(nome && email && mensagem) {
            const statusDiv = document.getElementById('formStatus');
            statusDiv.className = 'success-message';
            statusDiv.innerHTML = '✅ Mensagem enviada! Entraremos em contato em breve. ✨';
            this.reset();
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 4000);
        }
    });
}

// ===== NEWSLETTER =====
function initNewsletter() {
    const btn = document.getElementById('newsBtn');
    if (!btn) return;

    btn.addEventListener('click', function() {
        const email = document.getElementById('newsEmail')?.value;
        const statusDiv = document.getElementById('newsStatus');
        
        if(email && email.includes('@')) {
            let newsletters = JSON.parse(localStorage.getItem('oticamacae_newsletter') || '[]');
            if (!newsletters.includes(email)) {
                newsletters.push(email);
                localStorage.setItem('oticamacae_newsletter', JSON.stringify(newsletters));
            }
            
            statusDiv.className = 'success-message';
            statusDiv.innerHTML = '📧 Inscrito com sucesso! Você receberá nossas novidades. 🎉';
            if (document.getElementById('newsEmail')) {
                document.getElementById('newsEmail').value = '';
            }
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 3000);
        } else {
            statusDiv.className = 'error-message';
            statusDiv.innerHTML = '❌ Digite um e-mail válido.';
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 3000);
        }
    });
}

// ===== SCROLL SUAVE =====
function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const target = document.querySelector(this.getAttribute('href'));
            if(target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

// ===== ANIMAÇÃO DE SCROLL (REVELAR ELEMENTOS) =====
function initScrollAnimation() {
    const elements = document.querySelectorAll('.product-card, .about-grid, .form-card, .contact-info');
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if(entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    
    elements.forEach(element => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(40px)';
        element.style.transition = 'all 0.7s cubic-bezier(0.4, 0, 0.2, 1)';
        observer.observe(element);
    });
}

// ===== HEADER SCROLL EFFECT =====
function initHeaderScroll() {
    const header = document.querySelector('header');
    let lastScroll = 0;
    
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        if (currentScroll > 100) {
            header.style.background = 'rgba(15, 76, 47, 0.98)';
            header.style.backdropFilter = 'blur(15px)';
        } else {
            header.style.background = 'rgba(15, 76, 47, 0.95)';
        }
        
        lastScroll = currentScroll;
    });
}

// ===== ANO ATUAL =====
function setCurrentYear() {
    const yearElement = document.getElementById('currentYear');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
}

// ===== PRELOADER (OPCIONAL) =====
function initPreloader() {
    window.addEventListener('load', () => {
        const preloader = document.getElementById('preloader');
        if (preloader) {
            setTimeout(() => {
                preloader.style.opacity = '0';
                setTimeout(() => {
                    preloader.style.display = 'none';
                }, 300);
            }, 500);
        }
    });
}

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', () => {
    initCadastroForm();
    initContatoForm();
    initNewsletter();
    initSmoothScroll();
    initScrollAnimation();
    initHeaderScroll();
    setCurrentYear();
    initPreloader();
});