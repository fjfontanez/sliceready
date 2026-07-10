import './styles.css';
import { renderPromo } from './promo';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app not found');
renderPromo(root);
